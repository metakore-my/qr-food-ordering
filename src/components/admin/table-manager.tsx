"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { QrDisplay } from "@/components/admin/qr-display";
import { Pagination, paginate } from "@/components/ui/pagination";
import { useConfirm } from "@/components/providers/confirm-provider";

interface Table {
  id: number;
  number: number;
  token: string;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface TableManagerProps {
  initialTables: Table[];
}

export function TableManager({ initialTables }: TableManagerProps) {
  const t = useTranslations("admin.tables");
  const tCommon = useTranslations("common");
  const confirm = useConfirm();
  const [tables, setTables] = useState<Table[]>(
    [...initialTables].sort((a, b) => a.number - b.number)
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [qrTable, setQrTable] = useState<Table | null>(null);
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 20;
  const RANGE_RE = /^(\d+)(?:-(\d+))?$/;

  function validateInput(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = RANGE_RE.exec(trimmed);
    if (!match) return t("invalidRange");
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;
    if (start <= 0 || end <= 0) return t("invalidRange");
    if (start > end) return t("rangeInvalid");
    if (end - start + 1 > 50) return t("rangeTooLarge");
    return null;
  }

  async function handleAddTable(e: React.SyntheticEvent) {
    e.preventDefault();
    const validationError = validateInput(input);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToCreate"));
      }

      const data: { created: Table[]; skipped: number[] } = await res.json();

      if (data.created.length > 0) {
        setTables((prev) =>
          [...prev, ...data.created].sort((a, b) => a.number - b.number)
        );
      }

      if (data.created.length === 0 && data.skipped.length > 0) {
        setSuccess(t("allExist"));
      } else {
        const parts: string[] = [];
        if (data.created.length > 0) {
          parts.push(
            t("created", {
              tables: data.created.map((tb) => tb.number).join(", "),
            })
          );
        }
        if (data.skipped.length > 0) {
          parts.push(
            t("skipped", { tables: data.skipped.join(", ") })
          );
        }
        setSuccess(parts.join(" | "));
      }

      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleActive(table: Table) {
    try {
      const res = await fetch(`/api/tables/${table.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !table.isActive }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToUpdate"));
      }

      const updated = await res.json();
      setTables((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    }
  }

  async function handleDelete(table: Table) {
    if (!(await confirm({ message: t("confirmDeactivate", { number: table.number }) }))) {
      return;
    }

    try {
      const res = await fetch(`/api/tables/${table.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("failedToDelete"));
      }

      const updated = await res.json();
      setTables((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("errorGeneric"));
    }
  }

  return (
    <div>
      {/* Add Table Form */}
      <form
        onSubmit={handleAddTable}
        className="mb-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label
            htmlFor="tableNumber"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            {t("tableNumber")}
          </label>
          <input
            id="tableNumber"
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
              setSuccess(null);
            }}
            placeholder={t("tableNumberPlaceholder")}
            disabled={loading}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:cursor-not-allowed disabled:bg-gray-100"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-md bg-primary-500 px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? t("adding") : t("addTable")}
        </button>
      </form>

      {/* Error Message */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Tables List */}
      {tables.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-gray-500">{t("noTables")}</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                    {t("tableNumber")}
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                    {tCommon("status")}
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">
                    {tCommon("actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginate(tables, page, PAGE_SIZE).map((table) => (
                  <tr
                    key={table.id}
                    className="border-b border-gray-100 last:border-b-0"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {table.number}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          table.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {table.isActive ? tCommon("active") : tCommon("inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setQrTable(table)}
                          className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                          title={t("showQrCode")}
                        >
                          {t("qrCode")}
                        </button>
                        <button
                          onClick={() => handleToggleActive(table)}
                          className={`inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                            table.isActive
                              ? "border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                              : "border border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                          }`}
                        >
                          {table.isActive ? tCommon("deactivate") : tCommon("activate")}
                        </button>
                        {table.isActive && (
                          <button
                            onClick={() => handleDelete(table)}
                            className="inline-flex min-h-[44px] items-center rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                          >
                            {tCommon("delete")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="space-y-3 md:hidden">
            {paginate(tables, page, PAGE_SIZE).map((table) => (
              <div
                key={table.id}
                className={`rounded-lg border bg-white p-4 shadow-sm border-l-4 ${
                  table.isActive ? "border-l-green-500" : "border-l-gray-400"
                } border-gray-200`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-sm font-bold text-primary-700">
                      {table.number}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {t("tableNumber")} {table.number}
                      </p>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          table.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {table.isActive ? tCommon("active") : tCommon("inactive")}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setQrTable(table)}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                    title={t("showQrCode")}
                  >
                    {t("qrCode")}
                  </button>
                  <button
                    onClick={() => handleToggleActive(table)}
                    className={`inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                      table.isActive
                        ? "border border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                        : "border border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                    }`}
                  >
                    {table.isActive ? tCommon("deactivate") : tCommon("activate")}
                  </button>
                  {table.isActive && (
                    <button
                      onClick={() => handleDelete(table)}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                    >
                      {tCommon("delete")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Pagination
        currentPage={page}
        totalItems={tables.length}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />

      {/* QR Code Modal */}
      {qrTable && (
        <QrDisplay
          tableId={qrTable.id}
          tableNumber={qrTable.number}
          onClose={() => setQrTable(null)}
        />
      )}
    </div>
  );
}
