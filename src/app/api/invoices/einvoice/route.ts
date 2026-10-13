// ============================================================================
// Tau ERP — /api/invoices/einvoice — SYNTHETIC e-Invoice IRN generation.
// HARD RULE: never calls any real/external endpoint — IRN is generated locally
// as a pseudo-random 64-hex string and every response is labelled SANDBOX_MOCK.
//
// POST { invoiceNumber, simulate?: "timeout" }
//   idempotencyKey = `IDM-${invoiceNumber}-irn-request`
//   • SUCCESS log already exists → return cached IRN + audit
//     "duplicate prevented by idempotency key" (demo: call the button twice).
//   • simulate === "timeout" (first call) → PENDING log, attempts=1,
//     error "provider timeout"; the NEXT call retries → SUCCESS (attempts+1).
//   • otherwise → IRN generated, invoice EINVOICED, qrPayload written.
// ============================================================================
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { ApiError, body, handle, getSessionUser, logAudit, ok, requirePerm } from "@/lib/erp/server";
import { COMPANY } from "@/lib/erp/constants";

const J = (o: unknown) => JSON.stringify(o);
const hex = () => randomUUID().replaceAll("-", "");
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requirePerm(await getSessionUser(req), "sales.invoice");
    const b = await body<{ invoiceNumber?: string; simulate?: string }>(req);
    const invoiceNumber = String(b.invoiceNumber ?? "");
    const simulate = String(b.simulate ?? "");

    const invoice = await db.salesInvoice.findUnique({ where: { invoiceNumber } });
    if (!invoice) throw new ApiError("Invoice not found", 404);
    if (invoice.status === "CANCELLED" || invoice.status === "DRAFT") {
      throw new ApiError(`e-Invoice requires an ISSUED invoice — ${invoiceNumber} is ${invoice.status}`, 409);
    }
    const so = await db.salesOrder.findUnique({ where: { id: invoice.soId } });
    if (!so) throw new ApiError("Sales order for this invoice not found", 404);
    const customer = await db.customer.findUnique({ where: { id: so.customerId } });
    if (!customer) throw new ApiError("Customer for this invoice not found", 404);

    const idempotencyKey = `IDM-${invoiceNumber}-irn-request`;
    const correlationId = `corr-${hex().slice(0, 8)}`;
    const existing = await db.eInvoiceLog.findUnique({ where: { idempotencyKey } });

    // ---------------------------------------------------------------- dedup —
    // same idempotency key already SUCCESS → serve the cached IRN, never
    // regenerate. (Spec: "duplicate prevented by idempotency key")
    if (existing && existing.status === "SUCCESS") {
      const cached = parseIrn(existing.responseJson) ?? invoice.irn;
      await logAudit(user, "EINVOICE", "SalesInvoice", invoiceNumber, "duplicate prevented by idempotency key");
      return ok({
        status: "SUCCESS",
        cached: true,
        irn: cached,
        attempts: existing.attempts,
        message: "Duplicate request — IRN served from idempotency cache (SANDBOX_MOCK)",
      });
    }

    // ------------------------------------------------- simulated timeout ----
    // first timeout call holds the request PENDING; the next call retries.
    if (simulate === "timeout" && !existing) {
      await db.eInvoiceLog.create({
        data: {
          invoiceNumber,
          idempotencyKey,
          correlationId,
          mode: "SANDBOX_MOCK",
          requestJson: J({ action: "GENERATE_IRN", docNo: invoiceNumber, seller: COMPANY.gstin, buyer: customer.gstin, value: invoice.total, simulated: true }),
          status: "PENDING",
          attempts: 1,
          errorMessage: "provider timeout (simulated)",
        },
      });
      await db.salesInvoice.update({ where: { id: invoice.id }, data: { status: "EINVOICE_PENDING" } });
      await logAudit(user, "EINVOICE", "SalesInvoice", invoiceNumber, "provider timeout (simulated) — IRN request held PENDING, call again to retry");
      return ok({ status: "TIMEOUT", attempts: 1, cached: false, message: "provider timeout (simulated) — IRN request PENDING; call Generate again to retry" });
    }

    // ------------------------------------------------------- success path ---
    // (normal generate, retry after timeout, or 'duplicate' demo first leg)
    const attempts = (existing?.attempts ?? 0) + 1;
    const irn = hex() + hex(); // 64-hex pseudo-random IRN — NOT a real IRN
    const now = new Date();
    const ackNo = `SYNTH-${hex().slice(0, 6).toUpperCase()}`;
    const qr = { SellerGSTIN: COMPANY.gstin, BuyerGSTIN: customer.gstin, DocNo: invoiceNumber, TotAmt: round2(invoice.total), IRN: irn };

    await db.$transaction([
      db.eInvoiceLog.upsert({
        where: { idempotencyKey },
        create: {
          invoiceNumber,
          idempotencyKey,
          correlationId: existing?.correlationId || correlationId,
          mode: "SANDBOX_MOCK",
          requestJson: J({ action: "GENERATE_IRN", docNo: invoiceNumber, seller: COMPANY.gstin, buyer: customer.gstin, value: invoice.total }),
          responseJson: J({ irn, ackNo, ackDate: now.toISOString(), note: "MOCK — not a statutory document" }),
          status: "SUCCESS",
          attempts,
        },
        update: {
          status: "SUCCESS",
          attempts,
          errorMessage: "",
          responseJson: J({ irn, ackNo, ackDate: now.toISOString(), note: "MOCK — not a statutory document", retried: attempts > 1 }),
        },
      }),
      db.salesInvoice.update({
        where: { id: invoice.id },
        data: { status: "EINVOICED", irn, irnAt: now, qrPayloadJson: J(qr) },
      }),
    ]);
    await logAudit(user, "EINVOICE", "SalesInvoice", invoiceNumber, `IRN generated (SANDBOX_MOCK, attempt ${attempts}${attempts > 1 ? " after simulated timeout" : ""}) — ackNo ${ackNo}`);
    await db.notification.create({
      data: {
        role: "FINANCE_MGR",
        kind: "INTEGRATION",
        severity: "INFO",
        title: `e-Invoice issued (sandbox mock) — ${invoiceNumber}`,
        message: `IRN generated in SANDBOX_MOCK mode (attempt ${attempts}). IRN: ${irn.slice(0, 12)}… Duplicate submissions are deduplicated by idempotency key.`,
        refType: "INVOICE",
        refId: invoiceNumber,
      },
    });
    return ok({ status: "SUCCESS", cached: false, irn, attempts, ackNo, message: `IRN generated (SANDBOX_MOCK, attempt ${attempts})` });
  });
}

function parseIrn(responseJson: string): string | null {
  try {
    const o = JSON.parse(responseJson) as { irn?: string };
    return typeof o.irn === "string" ? o.irn : null;
  } catch {
    return null;
  }
}
