'use server';

import {revalidatePath} from 'next/cache';
import {auth} from '@/auth';
import {getActiveContext} from '@/src/active-context';
import {canManageRoles, COOP_VIEW_KEY, type CompanyRole} from '@/src/company';
import {countCoopAdmins, grantRole, revoke, setStatus} from '@/src/admin-data';

// Role-management actions — the ONLY write surface for access. Every action
// re-derives the active view server-side and requires it to be the Coop Admin view
// (canManageRoles), never trusting the client. Lockout guards prevent removing the
// last Coop Admin or an admin suspending/revoking their own access.

export type AdminResult = {ok: true} | {ok: false; error: string};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GRANTABLE: CompanyRole[] = ['company_admin', 'coop_admin']; // v1 roles

async function requireCoopAdmin(): Promise<{actor: string} | {error: string}> {
  const ctx = await getActiveContext();
  if (!ctx || !canManageRoles(ctx.role)) return {error: 'Not authorized — switch to your Coop Admin view.'};
  const session = await auth();
  const actor = session?.user?.email?.toLowerCase();
  if (!actor) return {error: 'Not authorized.'};
  return {actor};
}

/** 'coop_admin' sentinel → null company; otherwise a validated company slug. */
function parseCompany(companyKey: string): string | null | undefined {
  if (companyKey === COOP_VIEW_KEY) return null;
  return /^[a-z0-9_-]{1,64}$/.test(companyKey) ? companyKey : undefined; // undefined = invalid
}

export async function grantRoleAction(input: {email: string; companyKey: string; role: CompanyRole}): Promise<AdminResult> {
  const gate = await requireCoopAdmin();
  if ('error' in gate) return {ok: false, error: gate.error};

  const email = (input.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) return {ok: false, error: 'Enter a valid email address.'};
  if (!GRANTABLE.includes(input.role)) return {ok: false, error: 'Unknown role.'};

  const companyId = parseCompany(input.companyKey);
  if (companyId === undefined) return {ok: false, error: 'Unknown company.'};
  if (companyId === null && input.role !== 'coop_admin') return {ok: false, error: 'A company role needs a company.'};
  if (companyId !== null && input.role === 'coop_admin') return {ok: false, error: 'Coop Admin is cross-tenant — leave the company blank.'};

  try {
    await grantRole({actor: gate.actor, email, companyId, role: input.role});
    revalidatePath('/admin/users');
    return {ok: true};
  } catch (e) {
    console.error('grantRoleAction', e);
    return {ok: false, error: 'Could not grant the role — please try again.'};
  }
}

export async function setStatusAction(input: {email: string; companyKey: string; status: 'active' | 'suspended'}): Promise<AdminResult> {
  const gate = await requireCoopAdmin();
  if ('error' in gate) return {ok: false, error: gate.error};
  const email = (input.email ?? '').trim().toLowerCase();
  const companyId = parseCompany(input.companyKey);
  if (companyId === undefined) return {ok: false, error: 'Unknown company.'};

  if (companyId === null && input.status === 'suspended') {
    if (email === gate.actor) return {ok: false, error: "You can't suspend your own Coop Admin access."};
    if ((await countCoopAdmins()) <= 1) return {ok: false, error: 'At least one active Coop Admin must remain.'};
  }
  try {
    await setStatus({actor: gate.actor, email, companyId, status: input.status});
    revalidatePath('/admin/users');
    return {ok: true};
  } catch (e) {
    console.error('setStatusAction', e);
    return {ok: false, error: 'Could not update access — please try again.'};
  }
}

export async function revokeAction(input: {email: string; companyKey: string}): Promise<AdminResult> {
  const gate = await requireCoopAdmin();
  if ('error' in gate) return {ok: false, error: gate.error};
  const email = (input.email ?? '').trim().toLowerCase();
  const companyId = parseCompany(input.companyKey);
  if (companyId === undefined) return {ok: false, error: 'Unknown company.'};

  if (companyId === null) {
    if (email === gate.actor) return {ok: false, error: "You can't revoke your own Coop Admin access."};
    if ((await countCoopAdmins()) <= 1) return {ok: false, error: 'At least one active Coop Admin must remain.'};
  }
  try {
    await revoke({actor: gate.actor, email, companyId});
    revalidatePath('/admin/users');
    return {ok: true};
  } catch (e) {
    console.error('revokeAction', e);
    return {ok: false, error: 'Could not revoke access — please try again.'};
  }
}
