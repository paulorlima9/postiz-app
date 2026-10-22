import { describe, expect, it } from 'vitest';

import { stubFetch } from '@gitroom/testing/http/fetch.stub';
import { LinkedinPageProvider } from './linkedin.page.provider';

const acl = (id: string, name: string, role = 'ADMINISTRATOR', kind = 'organization') => ({
  role,
  organizationalTarget: `urn:li:${kind}:${id}`,
  'organizationalTarget~': { localizedName: name, vanityName: name.toLowerCase() },
});

const brand = (parent: string) => ({
  primaryOrganizationType: 'BRAND',
  parentRelationship: { parent: `urn:li:organization:${parent}` },
});

/**
 * Showcase Pages are organizations whose primaryOrganizationType is BRAND, so
 * the ACL call already returns them; companies() only labels them and lists
 * each one after its parent.
 */
describe('LinkedinPageProvider.companies', () => {
  const provider = new LinkedinPageProvider();

  it('labels Showcase Pages and lists each one after its parent', async () => {
    const http = stubFetch([
      ['organizationalEntityAcls', () => ({
        elements: [acl('20', 'Brand'), acl('10', 'Acme'), acl('30', 'Other'), acl('40', 'Viewer', 'ANALYST')],
      })],
      ['/rest/organizations?ids=', () => ({
        results: { '10': { primaryOrganizationType: 'NONE' }, '20': brand('10'), '30': { primaryOrganizationType: 'NONE' } },
      })],
    ]);

    const pages = await provider.companies('token');

    expect(pages.map((p: any) => [p.id, p.type, p.parent])).toEqual([
      ['10', 'company', undefined],
      ['20', 'showcase', 'Acme'],
      ['30', 'company', undefined],
    ]);
    expect(http.urls()[1]).toContain('/rest/organizations?ids=List(20,10,30)');
    expect(pages.every((p: any) => !('parentId' in p))).toBe(true);
  });

  it('keeps a legacy organizationBrand target under its organization id', async () => {
    stubFetch([
      ['organizationalEntityAcls', () => ({ elements: [acl('10', 'Acme'), acl('20', 'Brand', 'ADMINISTRATOR', 'organizationBrand')] })],
      ['/rest/organizations?ids=', () => ({ results: { '10': { primaryOrganizationType: 'NONE' }, '20': brand('10') } })],
    ]);

    const pages = await provider.companies('token');

    expect(pages.map((p: any) => [p.id, p.page, p.type])).toEqual([
      ['10', '10', 'company'],
      ['20', '20', 'showcase'],
    ]);
  });

  it('lists a Showcase Page whose parent the member does not administer, without a parent', async () => {
    stubFetch([
      ['organizationalEntityAcls', () => ({ elements: [acl('20', 'Brand')] })],
      ['/rest/organizations?ids=', () => ({ results: { '20': brand('99') } })],
    ]);

    const pages = await provider.companies('token');

    expect(pages.map((p: any) => [p.id, p.type, p.parent])).toEqual([['20', 'showcase', undefined]]);
  });

  it('never drops a page the grouping cannot place', async () => {
    stubFetch([
      ['organizationalEntityAcls', () => ({ elements: [acl('10', 'Acme'), acl('20', 'Brand'), acl('30', 'Sub')] })],
      ['/rest/organizations?ids=', () => ({
        results: { '10': { primaryOrganizationType: 'NONE' }, '20': brand('10'), '30': brand('20') },
      })],
    ]);

    const pages = await provider.companies('token');

    expect(pages.map((p: any) => p.id)).toEqual(['10', '20', '30']);
  });

  it('returns the list unchanged when the lookup fails', async () => {
    stubFetch([
      ['organizationalEntityAcls', () => ({ elements: [acl('10', 'Acme'), acl('20', 'Brand')] })],
      ['/rest/organizations?ids=', () => new Response('Service Unavailable', { status: 503 })],
    ]);

    const pages = await provider.companies('token');

    expect(pages.map((p: any) => [p.id, p.type])).toEqual([
      ['10', undefined],
      ['20', undefined],
    ]);
  });

  it('treats every page as a company when LinkedIn answers the lookup with an error body', async () => {
    stubFetch([
      ['organizationalEntityAcls', () => ({ elements: [acl('10', 'Acme')] })],
      ['/rest/organizations?ids=', () => ({ status: 403, message: 'Not enough permissions' })],
    ]);

    const pages = await provider.companies('token');

    expect(pages.map((p: any) => [p.id, p.type])).toEqual([['10', 'company']]);
  });

  it('makes no lookup when the member administers no page', async () => {
    const http = stubFetch([['organizationalEntityAcls', () => ({ elements: [] })]]);

    expect(await provider.companies('token')).toEqual([]);
    expect(http.countTo('/rest/organizations')).toBe(0);
  });
});
