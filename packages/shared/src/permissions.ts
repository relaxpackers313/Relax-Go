/** Admin permission catalog. Admin users hold a role plus explicit permissions; routes guard with requirePermission. */

export const PERMISSIONS = [
  // Drivers
  'drivers.view',
  'drivers.approve',
  'drivers.suspend',
  'drivers.edit',
  'drivers.documents.review',
  // Customers
  'customers.view',
  'customers.block',
  // Location privacy is its own permission set (spec §66)
  'locations.live.view',
  'locations.history.view',
  // Leads / calls / trips
  'leads.view',
  'leads.manage',
  'calls.view',
  'trips.view',
  // Money
  'wallets.view',
  'wallets.adjust',
  'payments.view',
  'payments.refund',
  'pricing.manage',
  // Platform
  'settings.view',
  'settings.edit',
  'serviceareas.manage',
  'reports.view',
  'support.manage',
  'audit.view',
  'admins.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ADMIN_ROLES = ['superadmin', 'operations', 'finance', 'support'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Default permission bundles per role; superadmin implicitly holds everything. */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  superadmin: PERMISSIONS,
  operations: [
    'drivers.view', 'drivers.approve', 'drivers.suspend', 'drivers.edit', 'drivers.documents.review',
    'customers.view', 'locations.live.view', 'leads.view', 'leads.manage', 'calls.view', 'trips.view',
    'serviceareas.manage', 'reports.view', 'settings.view',
  ],
  finance: ['wallets.view', 'wallets.adjust', 'payments.view', 'payments.refund', 'pricing.manage', 'reports.view', 'calls.view', 'settings.view'],
  support: ['drivers.view', 'customers.view', 'leads.view', 'calls.view', 'support.manage'],
};

export function hasPermission(user: { role: AdminRole; permissions?: readonly string[] }, permission: Permission): boolean {
  if (user.role === 'superadmin') return true;
  if (user.permissions?.includes(permission)) return true;
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}
