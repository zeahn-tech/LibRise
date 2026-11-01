/**
 * Account deletion, server step.
 *
 * The database does the data work (anonymise, delete personal data, deactivate and ban the account) in one
 * transaction: delete_my_account(). This module wraps it with the parts the database cannot do:
 *
 *   1. refuse unless the caller typed DELETE and proved they know the password (a stolen/unattended session alone
 *      cannot delete an account);
 *   2. ask the database whether anything blocks deletion (last administrator, sole owner of a team, payment waiting
 *      for review) BEFORE touching anything;
 *   3. note which files the person uploaded (the database knows the exact storage paths) while that is still possible;
 *   4. run the database deletion (the point of no return: the account is deactivated and cannot read data any more);
 *   5. remove the files from storage (through the Storage API: files cannot be removed with SQL) including any
 *      uploaded-but-never-attached leftovers found by listing the person's own folders;
 *   6. delete the sign-in account so the email address is free again.
 *
 * After step 4 the account is already unusable, so a failure in step 5 or 6 does not undo the deletion; it is
 * reported as a warning (and logged by the caller) instead of pretending everything succeeded.
 *
 * Dependencies are injected: this file holds no credentials. server.ts builds them from server-only variables.
 */
export interface Blocker {
  code: string;
  message: string;
}

export interface StoragePaths {
  applicationDocuments: string[];
  verificationDocuments: string[];
  messageAttachments: string[];
}

type DbError = { code?: string; message: string } | null;

export const BUCKETS = {
  applicationDocuments: 'application-documents',
  verificationDocuments: 'verification-documents',
  messageAttachments: 'message-attachments'
} as const;

export interface AccountDeletionDeps {
  userId: string;
  getBlockers(): Promise<{ data: Blocker[] | null; error: DbError }>;
  getStoragePaths(): Promise<{ data: StoragePaths | null; error: DbError }>;
  verifyPassword(password: string): Promise<{ ok: boolean; error?: string }>;
  deleteAccountData(): Promise<{ error: DbError }>;
  /** Removes exact object paths from a bucket. */
  removeFiles(bucket: string, paths: string[]): Promise<{ error: { message: string } | null }>;
  /** Every object path below `<prefix>/` in a bucket (recursive). */
  listFiles(bucket: string, prefix: string): Promise<{ paths: string[]; error: { message: string } | null }>;
  deleteAuthUser(): Promise<{ error: { message: string } | null }>;
}

export interface AccountDeletionResult {
  status: number;
  body: { success: boolean; error?: string; blockers?: Blocker[]; warnings?: string[] };
}

const CHUNK = 100;

const safeStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

export async function deleteAccount(deps: AccountDeletionDeps, input: { confirm?: unknown; password?: unknown }): Promise<AccountDeletionResult> {
  if (input.confirm !== 'DELETE') {
    return { status: 400, body: { success: false, error: 'Type DELETE to confirm.' } };
  }
  if (typeof input.password !== 'string' || input.password.length === 0 || input.password.length > 256) {
    return { status: 400, body: { success: false, error: 'Enter your password to confirm.' } };
  }

  const pw = await deps.verifyPassword(input.password);
  if (!pw.ok) {
    return { status: 401, body: { success: false, error: pw.error || 'Incorrect password.' } };
  }

  const blockers = await deps.getBlockers();
  if (blockers.error) {
    return blockers.error.code === '42501'
      ? { status: 403, body: { success: false, error: 'This account cannot be deleted right now. If it is suspended, please contact support.' } }
      : { status: 502, body: { success: false, error: 'Could not check whether your account can be deleted. Nothing was changed.' } };
  }
  if (blockers.data && blockers.data.length > 0) {
    return { status: 409, body: { success: false, error: blockers.data[0].message, blockers: blockers.data } };
  }

  const paths = await deps.getStoragePaths();
  if (paths.error || !paths.data) {
    return { status: 502, body: { success: false, error: 'Could not prepare your account for deletion. Nothing was changed.' } };
  }

  // Point of no return.
  const deleted = await deps.deleteAccountData();
  if (deleted.error) {
    if (deleted.error.code === '22023') {
      return { status: 409, body: { success: false, error: deleted.error.message } };
    }
    if (deleted.error.code === '42501') {
      return { status: 403, body: { success: false, error: 'This account cannot be deleted right now. If it is suspended, please contact support.' } };
    }
    return { status: 502, body: { success: false, error: 'Your account could not be deleted. Nothing was changed.' } };
  }

  const warnings: string[] = [];

  const plan: Array<[string, string[]]> = [
    [BUCKETS.applicationDocuments, safeStrings(paths.data.applicationDocuments)],
    [BUCKETS.verificationDocuments, safeStrings(paths.data.verificationDocuments)],
    [BUCKETS.messageAttachments, safeStrings(paths.data.messageAttachments)]
  ];

  // Also sweep the person's own folders: files uploaded but never attached to anything are not in any record.
  for (const bucket of [BUCKETS.applicationDocuments, BUCKETS.verificationDocuments]) {
    const listed = await deps.listFiles(bucket, deps.userId);
    if (listed.error) {
      warnings.push(`Could not list leftover files in ${bucket}: ${listed.error.message}`);
      continue;
    }
    const entry = plan.find(([b]) => b === bucket)!;
    entry[1] = Array.from(new Set([...entry[1], ...listed.paths]));
  }

  for (const [bucket, all] of plan) {
    for (let i = 0; i < all.length; i += CHUNK) {
      const { error } = await deps.removeFiles(bucket, all.slice(i, i + CHUNK));
      if (error) warnings.push(`Some files in ${bucket} could not be removed: ${error.message}`);
    }
  }

  const auth = await deps.deleteAuthUser();
  if (auth.error) {
    warnings.push(`The sign-in account could not be removed yet (${auth.error.message}). It is already disabled and cannot be used.`);
  }

  return { status: 200, body: { success: true, warnings } };
}
