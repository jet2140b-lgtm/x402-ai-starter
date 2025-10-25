export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

// BigInt-safe JSON
function safeJson(data: any, status = 200) {
  const body = JSON.stringify(data, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  );
  return new NextResponse(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}
const ok = (d: any, s = 200) => safeJson(d, s);
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

// 只允许 base / base-sepolia，其他回退 base
function resolveNetwork(input?: string | null) {
  const n = (input || "").trim().toLowerCase();
  return n === "base-sepolia" ? "base-sepolia" : "base";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token =
    req.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const address =
    url.searchParams.get("address") || process.env.SMART_ACCOUNT_ADDRESS;
  if (!address)
    return ok({ ok: false, error: "missing smart account address" }, 400);

  const ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS;
  if (!ownerAddress)
    return ok(
      { ok: false, error: "missing owner (CDP_OWNER_EOA_ADDRESS)" },
      400
    );

  const network = resolveNetwork(
    url.searchParams.get("network") || process.env.NETWORK || "base"
  );

  // 统一使用十六进制零金额；data 必须 "0x"
  const tx = { to: ownerAddress as `0x${string}`, value: "0x0", data: "0x" };

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 拿“真” SmartAccount 实例（某些版本只支持实例方法）
    let sa: any = null;
    if (cdp?.evm?.getSmartAccount) {
      try {
        sa = await cdp.evm.getSmartAccount({ address, network });
      } catch {
        sa = await cdp.evm.getSmartAccount({ address });
      }
    }
    if (!sa) sa = { address, owner: { address: ownerAddress } };

    const debug: any = {
      network,
      address,
      owner: ownerAddress,
      hasObjSend: typeof sa?.sendUserOperation === "function",
      hasObjWait: typeof sa?.waitForUserOperation === "function",
      hasCdpSend: typeof cdp?.evm?.sendUserOperation === "function",
      hasCdpWait: typeof cdp?.evm?.waitForUserOperation === "function",
    };

    // —— 尝试 1：SmartAccount 实例方法 + calls
    if (debug.hasObjSend) {
      try {
        const res = await sa.sendUserOperation({
          network,
          calls: [tx], // 形状 A
        });
        const userOpHash = res?.userOpHash;
        const receipt = debug.hasObjWait
          ? await sa.waitForUserOperation({ userOpHash })
          : await cdp.evm.waitForUserOperation({ smartAccount: sa, userOpHash });

        return ok({
          ok: receipt?.status === "complete",
          deployed: receipt?.status === "complete",
          smartAccount: address,
          owner: ownerAddress,
          network,
          userOpHash,
          debug: { method: "sa.sendUserOperation(calls[])" },
        });
      } catch (e: any) {
        debug.try1Error = String(e?.message || e);
      }
    }

    // —— 尝试 2：cdp.evm + calls
    if (debug.hasCdpSend) {
      try {
        const res = await cdp.evm.sendUserOperation({
          smartAccount: sa,
          network,
          calls: [tx], // 形状 B
        });
        const userOpHash = res?.userOpHash;
        const receipt = debug.hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccount: sa, userOpHash })
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
          debug: { method: "cdp.evm.sendUserOperation(calls[])" },
        });
      } catch (e: any) {
        debug.try2Error = String(e?.message || e);
      }
    }

    // —— 尝试 3：cdp.evm + transactions（某些历史版本字段名是 transactions）
    if (debug.hasCdpSend) {
      try {
        const res = await cdp.evm.sendUserOperation({
          smartAccount: sa,
          network,
          transactions: [tx], // 形状 C
        });
        const userOpHash = res?.userOpHash;
        const receipt = debug.hasCdpWait
          ? await cdp.evm.waitForUserOperation({ smartAccount: sa, userOpHash })
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
          debug: { method: "cdp.evm.sendUserOperation(transactions[])" },
        });
      } catch (e: any) {
        debug.try3Error = String(e?.message || e);
      }
    }

    // 三种都失败，吐出 debug
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error:
        "All variants failed. See debug.try1Error/try2Error/try3Error for details.",
      debug,
    });
  } catch (err: any) {
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error: String(err?.message || err),
    });
  }
}
