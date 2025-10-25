export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

// ---- helpers ----
function safeJson(data: any, status = 200) {
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { status, headers: { "content-type": "application/json" } });
}
const ok = (d: any, s = 200) => safeJson(d, s);
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

function resolveNetwork(input?: string | null) {
  const n = (input || "").trim().toLowerCase();
  return n === "base-sepolia" ? "base-sepolia" : "base";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = req.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const address = (url.searchParams.get("address") || process.env.SMART_ACCOUNT_ADDRESS || "").trim();
  if (!address) return ok({ ok: false, error: "missing smart account address" }, 400);

  const ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS;
  if (!ownerAddress) return ok({ ok: false, error: "missing CDP_OWNER_EOA_ADDRESS" }, 400);

  const network = resolveNetwork(url.searchParams.get("network") || process.env.NETWORK || "base");

  // 0 ETH 自转；金额十六进制，data 必须 "0x"
  const tx = { to: ownerAddress as `0x${string}`, value: "0x0", data: "0x" };

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 先尽量拿“真实例”，某些版本只认实例方法
    let sa: any = null;
    if (cdp?.evm?.getSmartAccount) {
      try {
        sa = await cdp.evm.getSmartAccount({ address, network });
      } catch {
        sa = await cdp.evm.getSmartAccount({ address });
      }
    }
    const debug: any = {
      address,
      owner: ownerAddress,
      network,
      gotInstance: !!sa,
      hasObjSend: typeof sa?.sendUserOperation === "function",
      hasObjWait: typeof sa?.waitForUserOperation === "function",
      hasCdpSend: typeof cdp?.evm?.sendUserOperation === "function",
      hasCdpWait: typeof cdp?.evm?.waitForUserOperation === "function",
    };

    // ==== 变体 1：实例方法 + calls ====
    if (debug.hasObjSend) {
      try {
        const res = await sa.sendUserOperation({ network, calls: [tx] });
        const userOpHash = res?.userOpHash;
        const receipt = debug.hasObjWait
          ? await sa.waitForUserOperation({ userOpHash })
          : debug.hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccount: sa, userOpHash })
          : null;
        return ok({
          ok: receipt?.status === "complete",
          deployed: receipt?.status === "complete",
          smartAccount: address,
          owner: ownerAddress,
          network,
          userOpHash,
          debug: { ...debug, method: "sa.sendUserOperation(calls[])" },
        });
      } catch (e: any) {
        debug.try1Error = String(e?.message || e);
      }
    }

    // ==== 变体 2：cdp.evm + calls，smartAccount 传实例 ====
    if (debug.hasCdpSend) {
      try {
        const res = await cdp.evm.sendUserOperation({ smartAccount: sa ?? { address }, network, calls: [tx] });
        const userOpHash = res?.userOpHash;
        const receipt = debug.hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccount: sa ?? { address }, userOpHash })
          : debug.hasObjWait
          ? await sa.waitForUserOperation({ userOpHash })
          : null;
        return ok({
          ok: receipt?.status === "complete",
          deployed: receipt?.status === "complete",
          smartAccount: address,
          owner: ownerAddress,
          network,
          userOpHash,
          debug: { ...debug, method: "cdp.evm.sendUserOperation(calls[]) + smartAccount" },
        });
      } catch (e: any) {
        debug.try2Error = String(e?.message || e);
      }
    }

    // ==== 变体 3：cdp.evm + transactions，smartAccount 传实例 ====
    if (debug.hasCdpSend) {
      try {
        const res = await cdp.evm.sendUserOperation({ smartAccount: sa ?? { address }, network, transactions: [tx] });
        const userOpHash = res?.userOpHash;
        const receipt = debug.hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccount: sa ?? { address }, userOpHash })
          : debug.hasObjWait
          ? await sa.waitForUserOperation({ userOpHash })
          : null;
        return ok({
          ok: receipt?.status === "complete",
          deployed: receipt?.status === "complete",
          smartAccount: address,
          owner: ownerAddress,
          network,
          userOpHash,
          debug: { ...debug, method: "cdp.evm.sendUserOperation(transactions[]) + smartAccount" },
        });
      } catch (e: any) {
        debug.try3Error = String(e?.message || e);
      }
    }

    // ==== 变体 4：cdp.evm + calls，传 smartAccountAddress（不少版本要求这样） ====
    if (debug.hasCdpSend) {
      try {
        const res = await cdp.evm.sendUserOperation({
          smartAccountAddress: address,    // <—
          owner: { address: ownerAddress },// 有些版本还需要 owner
          network,
          calls: [tx],
        });
        const userOpHash = res?.userOpHash;
        const receipt = debug.hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccountAddress: address, userOpHash })
          : debug.hasObjWait
          ? await sa.waitForUserOperation({ userOpHash })
          : null;
        return ok({
          ok: receipt?.status === "complete",
          deployed: receipt?.status === "complete",
          smartAccount: address,
          owner: ownerAddress,
          network,
          userOpHash,
          debug: { ...debug, method: "cdp.evm.sendUserOperation(calls[]) + smartAccountAddress" },
        });
      } catch (e: any) {
        debug.try4Error = String(e?.message || e);
      }
    }

    // ==== 变体 5：cdp.evm + transactions，传 smartAccountAddress ====
    if (debug.hasCdpSend) {
      try {
        const res = await cdp.evm.sendUserOperation({
          smartAccountAddress: address,    // <—
          owner: { address: ownerAddress },
          network,
          transactions: [tx],
        });
        const userOpHash = res?.userOpHash;
        const receipt = debug.hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccountAddress: address, userOpHash })
          : debug.hasObjWait
          ? await sa.waitForUserOperation({ userOpHash })
          : null;
        return ok({
          ok: receipt?.status === "complete",
          deployed: receipt?.status === "complete",
          smartAccount: address,
          owner: ownerAddress,
          network,
          userOpHash,
          debug: { ...debug, method: "cdp.evm.sendUserOperation(transactions[]) + smartAccountAddress" },
        });
      } catch (e: any) {
        debug.try5Error = String(e?.message || e);
      }
    }

    // 全部失败
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error: "All variants failed. Inspect debug.try1Error..try5Error",
      debug,
      next: "确保该 SA 余额 ≥ 0.015–0.02 Base ETH，或在 Portal 打开 Gas Sponsorship。",
    });
  } catch (e: any) {
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error: String(e?.message || e),
    });
  }
}
