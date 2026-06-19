"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Pagination, paginate } from "@/components/ui/pagination";
import { useConfirm } from "@/components/providers/confirm-provider";
import { formatDeploymentDate } from "@/lib/date";

interface User {
  id: number;
  username: string;
  role: "ADMIN" | "SUPERADMIN";
  permissions: string[];
  isActive: boolean;
  createdAt: string;
}

interface FormData {
  username: string;
  password: string;
  role: "ADMIN" | "SUPERADMIN";
  permissions: string[];
}

const ASSIGNABLE_PERMISSIONS = ["menu", "tables", "reports", "orders"] as const;

export function UserForm({ currentUserId }: { currentUserId: string }) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const confirm = useConfirm();

  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<FormData>({
    username: "",
    password: "",
    role: "ADMIN",
    // Pre-tick "orders" so a new ADMIN starts with a usable permission (the
    // most common staff role is order-taking). An ADMIN needs ≥1 permission to
    // be created at all; this saves a click and avoids the "no permission"
    // error on the typical path. The operator can change it before saving.
    permissions: ["orders"],
  });
  const [formErrors, setFormErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordErrors, setResetPasswordErrors] = useState<string[]>([]);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error(t("failedToFetch"));
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [t, tCommon]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function openAddModal() {
    setEditingUser(null);
    // Default a new ADMIN to the "orders" permission ticked (see initial state).
    setFormData({ username: "", password: "", role: "ADMIN", permissions: ["orders"] });
    setFormErrors({});
    setShowPassword(false);
    setShowModal(true);
  }

  function openEditModal(user: User) {
    setEditingUser(user);
    setFormData({ username: user.username, password: "", role: user.role, permissions: user.permissions ?? [] });
    setFormErrors({});
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingUser(null);
    setFormData({ username: "", password: "", role: "ADMIN", permissions: [] });
    setFormErrors({});
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();

    // An ADMIN with no permissions can access nothing — require at least one
    // before hitting the API (which also enforces this). SUPERADMIN is exempt.
    if (formData.role === "ADMIN" && formData.permissions.length === 0) {
      setFormErrors({ permissions: [t("permissionRequired")] });
      return;
    }

    setSaving(true);
    setFormErrors({});
    setError(null);

    try {
      if (editingUser) {
        // Update existing user (username is immutable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: Record<string, any> = {
          role: formData.role,
          permissions: formData.role === "SUPERADMIN" ? [] : formData.permissions,
        };
        const res = await fetch(`/api/admin/users/${editingUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json();
          if (data.details) {
            setFormErrors(data.details);
            return;
          }
          throw new Error(data.error || t("failedToUpdate"));
        }

        const updated = await res.json();
        setUsers((prev) =>
          prev.map((u) => (u.id === updated.id ? updated : u))
        );
      } else {
        // Create new user
        const createBody = {
          ...formData,
          permissions: formData.role === "SUPERADMIN" ? [] : formData.permissions,
        };
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createBody),
        });

        if (!res.ok) {
          const data = await res.json();
          if (data.details) {
            setFormErrors(data.details);
            return;
          }
          throw new Error(data.error || t("failedToCreate"));
        }

        const created = await res.json();
        setUsers((prev) => [created, ...prev]);
      }

      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(user: User) {
    if (!(await confirm({ message: t("confirmDeactivate", { username: user.username }) }))) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToDeactivate"));
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, isActive: false } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    }
  }

  async function handleActivate(user: User) {
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToActivate"));
      }

      const updated = await res.json();
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    }
  }

  function openResetPasswordModal(user: User) {
    setResetPasswordUser(user);
    setResetPassword("");
    setShowResetPassword(false);
    setResetPasswordErrors([]);
    setResetSuccess(false);
  }

  function closeResetPasswordModal() {
    setResetPasswordUser(null);
    setResetPassword("");
    setResetPasswordErrors([]);
    setResetSuccess(false);
  }

  async function handleResetPassword(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!resetPasswordUser) return;

    // Client-side validation mirrors passwordSchema (8–16 chars, upper, lower,
    // digit). The max-16 check matters for parity: without it the server rejects
    // a 17+ char password with a 400 only after a round-trip.
    const errors: string[] = [];
    if (resetPassword.length < 8) errors.push(t("passwordMinLength"));
    if (resetPassword.length > 16) errors.push(t("passwordMaxLength"));
    if (!/[A-Z]/.test(resetPassword)) errors.push(t("passwordUppercase"));
    if (!/[a-z]/.test(resetPassword)) errors.push(t("passwordLowercase"));
    if (!/[0-9]/.test(resetPassword)) errors.push(t("passwordDigit"));
    if (errors.length > 0) {
      setResetPasswordErrors(errors);
      return;
    }

    setResettingPassword(true);
    setResetPasswordErrors([]);

    try {
      const res = await fetch(`/api/admin/users/${resetPasswordUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.details?.password) {
          setResetPasswordErrors(data.details.password);
          return;
        }
        throw new Error(data.error || t("failedToResetPassword"));
      }

      setResetSuccess(true);
      setTimeout(() => closeResetPasswordModal(), 1500);
    } catch (err) {
      setResetPasswordErrors([
        err instanceof Error ? err.message : t("failedToResetPassword"),
      ]);
    } finally {
      setResettingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-md bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:rounded-sm"
          >
            {tCommon("dismiss")}
          </button>
        </div>
      )}

      {/* Header with Add button */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{t("users")}</h2>
        <button
          onClick={openAddModal}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {t("addUser")}
        </button>
      </div>

      {/* Users Table — Desktop */}
      <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t("username")}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t("role")}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {tCommon("status")}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t("permissions")}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t("createdDate")}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  {tCommon("actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-8 text-center text-sm text-gray-500"
                  >
                    {t("noUsers")}
                  </td>
                </tr>
              ) : (
                paginate(users, page, 20).map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                      {user.username}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.role === "SUPERADMIN"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {user.role === "SUPERADMIN" ? t("roleSuperadmin") : t("roleAdmin")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          user.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {user.isActive ? tCommon("active") : tCommon("inactive")}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {user.role === "SUPERADMIN" ? (
                        <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                          {t("allAccess")}
                        </span>
                      ) : user.permissions.length === 0 ? (
                        <span className="text-xs text-gray-400">{t("dashboardOnly")}</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {user.permissions.map((p) => (
                            <span
                              key={p}
                              className="inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                            >
                              {t(`permission_${p}` as `permission_${string}`)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatDeploymentDate(user.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      {/* Hide actions for self and SUPERADMIN accounts */}
                      {String(user.id) === currentUserId || user.role === "SUPERADMIN" ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(user)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                          >
                            {tCommon("edit")}
                          </button>
                          <button
                            onClick={() => openResetPasswordModal(user)}
                            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
                          >
                            {t("resetPassword")}
                          </button>
                          {user.isActive ? (
                            <button
                              onClick={() => handleDeactivate(user)}
                              className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                            >
                              {tCommon("deactivate")}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleActivate(user)}
                              className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1"
                            >
                              {tCommon("activate")}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Users Cards — Mobile */}
      <div className="space-y-3 md:hidden">
        {users.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-6 py-8 text-center text-sm text-gray-500 shadow-sm">
            {t("noUsers")}
          </div>
        ) : (
          paginate(users, page, 20).map((user) => (
            <div
              key={user.id}
              className={`rounded-lg border border-gray-200 border-l-4 bg-white p-4 shadow-sm ${
                user.isActive ? "border-l-green-500" : "border-l-red-500"
              }`}
            >
              {/* Username + Role badge */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {user.username}
                </span>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    user.role === "SUPERADMIN"
                      ? "bg-purple-100 text-purple-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {user.role}
                </span>
              </div>

              {/* Status + Permissions */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    user.isActive
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {user.isActive ? tCommon("active") : tCommon("inactive")}
                </span>
                {user.role === "SUPERADMIN" ? (
                  <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                    {t("allAccess")}
                  </span>
                ) : user.permissions.length === 0 ? (
                  <span className="text-xs text-gray-400">{t("dashboardOnly")}</span>
                ) : (
                  user.permissions.map((p) => (
                    <span
                      key={p}
                      className="inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700"
                    >
                      {t(`permission_${p}` as `permission_${string}`)}
                    </span>
                  ))
                )}
              </div>

              {/* Created date */}
              <p className="mt-2 text-xs text-gray-500">
                {t("createdDate")}:{" "}
                {formatDeploymentDate(user.createdAt)}
              </p>

              {/* Actions */}
              {String(user.id) === currentUserId || user.role === "SUPERADMIN" ? (
                <p className="mt-3 text-xs text-gray-400">—</p>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => openEditModal(user)}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                  >
                    {tCommon("edit")}
                  </button>
                  <button
                    onClick={() => openResetPasswordModal(user)}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
                  >
                    {t("resetPassword")}
                  </button>
                  {user.isActive ? (
                    <button
                      onClick={() => handleDeactivate(user)}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                    >
                      {tCommon("deactivate")}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleActivate(user)}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1"
                    >
                      {tCommon("activate")}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <Pagination
        currentPage={page}
        totalItems={users.length}
        pageSize={20}
        onPageChange={setPage}
      />

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="user-form-title" className="mx-4 w-full max-w-md overflow-y-auto rounded-lg bg-white p-4 shadow-xl sm:p-6" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
            <div className="mb-4 flex items-center justify-between">
              <h3 id="user-form-title" className="text-lg font-semibold text-gray-900">
                {editingUser ? t("editUser") : t("addUserModal")}
              </h3>
              <button
                onClick={closeModal}
                className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                aria-label={tCommon("close")}
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t("username")}
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                  disabled={editingUser !== null}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                  required
                />
                {formErrors.username && (
                  <p className="mt-1 text-xs text-red-600">
                    {formErrors.username[0]}
                  </p>
                )}
              </div>

              {/* Password — only shown when creating a new user */}
              {!editingUser && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {t("password")}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          password: e.target.value,
                        }))
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-base focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      required
                      placeholder={t("passwordPlaceholderCreate")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:text-gray-900"

                    >
                      {showPassword ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {formErrors.password && (
                    <div className="mt-1 space-y-0.5">
                      {formErrors.password.map((err, i) => (
                        <p key={i} className="text-xs text-red-600">
                          {err}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Role */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t("role")}
                </label>
                <select
                  value={formData.role}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      role: e.target.value as "ADMIN" | "SUPERADMIN",
                    }))
                  }
                  disabled={editingUser !== null && String(editingUser.id) === currentUserId}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="ADMIN">{t("roleAdmin")}</option>
                  <option value="SUPERADMIN">{t("roleSuperadmin")}</option>
                </select>
              </div>

              {/* Permissions — only shown for ADMIN role */}
              {formData.role === "ADMIN" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {t("permissions")}
                  </label>
                  <p className="mb-2 text-xs text-gray-500">{t("permissionsHint")}</p>
                  <div className="space-y-2">
                    {ASSIGNABLE_PERMISSIONS.map((perm) => (
                      <label key={perm} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={formData.permissions.includes(perm)}
                          onChange={(e) => {
                            setFormData((prev) => ({
                              ...prev,
                              permissions: e.target.checked
                                ? [...prev.permissions, perm]
                                : prev.permissions.filter((p) => p !== perm),
                            }));
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700">
                          {t(`permission_${perm}` as `permission_${string}`)}
                        </span>
                      </label>
                    ))}
                  </div>
                  {formErrors.permissions && (
                    <p className="mt-1 text-xs text-red-600">
                      {formErrors.permissions[0]}
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                >
                  {tCommon("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:opacity-60"
                >
                  {saving
                    ? tCommon("saving")
                    : editingUser
                      ? t("updateUser")
                      : t("createUser")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPasswordUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="reset-password-title" className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 id="reset-password-title" className="text-lg font-semibold text-gray-900">
                {t("resetPasswordFor", { username: resetPasswordUser.username })}
              </h3>
              <button
                onClick={closeResetPasswordModal}
                className="flex h-11 w-11 items-center justify-center rounded-md text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                aria-label={tCommon("close")}
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {resetSuccess ? (
              <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
                {t("resetSuccess")}
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {t("newPassword")}
                  </label>
                  <div className="relative">
                    <input
                      type={showResetPassword ? "text" : "password"}
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-base focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      required
                      placeholder={t("newPasswordPlaceholder")}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:text-gray-900"

                    >
                      {showResetPassword ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {resetPasswordErrors.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {resetPasswordErrors.map((err, i) => (
                        <p key={i} className="text-xs text-red-600">
                          {err}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeResetPasswordModal}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                  >
                    {tCommon("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={resettingPassword}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    {resettingPassword ? t("resetting") : t("resetPassword")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
