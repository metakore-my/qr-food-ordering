/**
 * The settlement path is chosen by TABLE PRESENCE, not order type:
 *  - table-bound session  → settle the whole session at the table-QR checkout
 *    (sweeps every CONFIRMED order — dine-in AND takeaway together).
 *  - table-less session   → settle the single order via "Mark collected".
 */
export function settlementMode(session: { tableId: number | null }): "session" | "order" {
  return session.tableId == null ? "order" : "session";
}
