import {describe, expect, it} from 'vitest';
import {authorize, canChangeVisibility, canDelete, canEdit, canView, isOwner, isReportId, normalizeEmail, type AccessRow} from '../src/reports-access';

const team: AccessRow = {owner_email: 'a@zoomy.test', visibility: 'team', deleted_at: null};
const priv: AccessRow = {owner_email: 'a@zoomy.test', visibility: 'private', deleted_at: null};
const gone: AccessRow = {...priv, deleted_at: '2026-10-01T00:00:00Z'};
const A = 'a@zoomy.test';
const B = 'b@zoomy.test';

describe('Slice 4 #8: private reports are hidden from others', () => {
  it('a team report is viewable and editable by anyone signed in', () => {
    expect(canView(team, B)).toBe(true);
    expect(canEdit(team, B)).toBe(true);
  });
  it("a private report is the owner's only: another user gets 'hidden' for every action", () => {
    expect(canView(priv, B)).toBe(false);
    for (const action of ['view', 'edit', 'delete', 'visibility'] as const) expect(authorize(priv, B, action)).toEqual({ok: false, reason: 'hidden'});
    expect(authorize(priv, A, 'edit')).toEqual({ok: true});
  });
  it('a missing row is hidden too, so a stranger cannot tell missing from private', () => {
    expect(authorize(null, A, 'view')).toEqual({ok: false, reason: 'hidden'});
    expect(authorize(undefined, A, 'view')).toEqual({ok: false, reason: 'hidden'});
  });
  it('no email (no session) sees nothing', () => {
    for (const e of [null, undefined, '', '   ']) {
      expect(canView(team, e)).toBe(false);
      expect(authorize(team, e, 'view')).toEqual({ok: false, reason: 'hidden'});
    }
  });
});

describe('owner-only actions', () => {
  it('delete and visibility belong to the owner of a team report; others are forbidden, not hidden', () => {
    expect(canDelete(team, A)).toBe(true);
    expect(canChangeVisibility(team, A)).toBe(true);
    expect(canDelete(team, B)).toBe(false);
    expect(canChangeVisibility(team, B)).toBe(false);
    expect(authorize(team, B, 'delete')).toEqual({ok: false, reason: 'forbidden'});
    expect(authorize(team, B, 'visibility')).toEqual({ok: false, reason: 'forbidden'});
  });
  it('emails compare case-insensitively and trimmed', () => {
    expect(normalizeEmail('  A@Zoomy.TEST ')).toBe('a@zoomy.test');
    expect(isOwner(team, ' A@ZOOMY.test')).toBe(true);
    expect(isOwner(team, '')).toBe(false);
  });
});

describe('Slice 4 #9: a deleted report refuses every action', () => {
  it("reports 'deleted' to anyone who could see it, for every action", () => {
    const deletedTeam = {...team, deleted_at: '2026-10-01T00:00:00Z'};
    for (const action of ['view', 'edit', 'delete', 'visibility'] as const) {
      expect(authorize(deletedTeam, A, action)).toEqual({ok: false, reason: 'deleted'});
      expect(authorize(deletedTeam, B, action)).toEqual({ok: false, reason: 'deleted'});
    }
    expect(canEdit(deletedTeam, A)).toBe(false);
    expect(canDelete(deletedTeam, A)).toBe(false);
  });
  it("hidden wins over deleted: a stranger is never told a private report existed", () => {
    expect(authorize(gone, B, 'view')).toEqual({ok: false, reason: 'hidden'});
    expect(authorize(gone, A, 'view')).toEqual({ok: false, reason: 'deleted'});
  });
});

describe('isReportId', () => {
  it('accepts a uuid and refuses everything else', () => {
    expect(isReportId('00000000-0000-4000-8000-000000000001')).toBe(true);
    for (const v of ['', 'abc', '1; drop table', "00000000-0000-4000-8000-000000000001'", 5, null, undefined, {}]) expect(isReportId(v)).toBe(false);
  });
});
