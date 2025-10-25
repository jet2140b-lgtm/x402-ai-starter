export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

// BigInt-safe JSON
function safeJson(data: any, status = 200) {
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { status, headers: { "content-type": "application/json" } });
}
const ok = (d: any, s = 200) => safeJson(d, s);
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

// 只允许 base / base-sepolia，其它一律回退 base
function resolveNetwork(input?: string | null) {
  const n = (input || "").trim().toLowerCase();
  return n === "base-sepolia" ? "base-sepolia" : "base";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = req.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const address = url.searchParams.get("address") || process.env.SMART_ACCOUNT_ADDRESS;
  if (!address) return ok({ ok: false, error: "missing smart account address" }, 400);

  const ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS;
  if (!ownerAddress) return ok({ ok: false, error: "missing owner (CDP_OWNER_EOA_ADDRESS)" }, 400);

  const network = resolveNetwork(url.searchParams.get("network") || process.env.NETWORK || "base");

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 1) 尝试从 SDK 取“真对象”：有些版本必须用 getSmartAccount 得到可用对象
    let sa: any = null;
    if (cdp?.evm?.getSmartAccount) {
      try {
        sa = await cdp.evm.getSmartAccount({ address, network });
      } catch {
        sa = await cdp.evm.getSmartAccount({ address });
      }
    }
    // 若取不到，就退化为最小对象
    if (!sa) sa = { address, owner: { address: ownerAddress } };

    const hasObjSend = typeof sa.sendUserOperation === "function";
    const hasObjWait = typeof sa.waitForUserOperation === "function";
    const hasCdpSend = typeof cdp?.evm?.sendUserOperation === "function";
    const hasCdpWait = typeof cdp?.evm?.waitForUserOperation === "function";

    // 2) calls：改用十六进制 "0x0" 避免类型校验差异；data 显式 "0x"
    const calls = [{ to: ownerAddress as `0x${string}`, value: "0x0", data: "0x" }];

    // 3) 发送 UO（优先对象方法，其次 cdp.evm）
    let userOpHash: string | undefined;
    let methodUsed = "";
    if (hasObjSend) {
      methodUsed = "smartAccount.sendUserOperation";
      const res = await sa.sendUserOperation({ network, calls });
      userOpHash = res?.userOpHash;
    } else if (hasCdpSend) {
      methodUsed = "cdp.evm.sendUserOperation";
      const res = await cdp.evm.sendUserOperation({ smartAccount: sa, network, calls });
      userOpHash = res?.userOpHash;
    } else {
      return ok({
        ok: false,
        error: "No sendUserOperation available on smartAccount or cdp.evm",
        debug: { hasObjSend, hasCdpSend, hasObjWait, hasCdpWait, network, callsLen: calls.length },
      });
    }

    if (!userOpHash) {
      return ok({
        ok: false,
        error: "userOpHash missing after sendUserOperation",
        debug: { methodUsed, network, callsLen: calls.length },
      });
    }

    // 4) 等待（优先对象 wait，其次 cdp.evm）
    let receipt: any;
    if (hasObjWait) {
      methodUsed += " + smartAccount.waitForUserOperation";
      receipt = await sa.waitForUserOperation({ userOpHash });
    } else if (hasCdpWait) {
      methodUsed += " + cdp.evm.waitForUserOperation";
      receipt = await cdp.evm.waitForUserOperation({ smartAccount: sa, userOpHash });
    } else {
      return ok({
        ok: false,
        error: "No waitForUserOperation available",
        debug: { methodUsed, hasObjWait, hasCdpWait },
      });
    }

    return ok({
      ok: receipt?.status === "complete",
      deployed: receipt?.status === "complete",
      smartAccount: address,
      owner: ownerAddress,
      network,
      userOpHash,
      debug: { methodUsed }, // 如需，可删除
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
