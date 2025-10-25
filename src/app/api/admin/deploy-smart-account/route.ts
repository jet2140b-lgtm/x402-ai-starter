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

    // 1) 先创建 smartAccount 对象（带 owner）
    const smartAccount = { address, owner: { address: ownerAddress } } as any;

    // 2) 优先使用对象自身的方法（很多版本要求这样）
    const hasObjSend = typeof smartAccount.sendUserOperation === "function";
    const hasObjWait = typeof smartAccount.waitForUserOperation === "function";

    // 3) 准备 calls（全部用字符串，避免 bigint/类型不匹配）
    const calls = [
      {
        to: ownerAddress as `0x${string}`,
        value: "0",            // ✅ 字符串 "0"，避免 bigint
        data: "0x",            // ✅ 必须显式 "0x"
      },
    ];

    // 为了排错，先返回可见的关键形状
    const debug = {
      methodUsed: hasObjSend ? "smartAccount.sendUserOperation" : "cdp.evm.sendUserOperation",
      network,
      hasObjWait,
      callsShape: Array.isArray(calls) ? "array" : typeof calls,
      callsLen: (calls as any)?.length ?? null,
    };

    // 4) 发送 UO
    let userOpHash: string | undefined;
    if (hasObjSend) {
      // 某些版本：对象方法只要 { network, calls }
      const res = await smartAccount.sendUserOperation({ network, calls });
      userOpHash = res?.userOpHash;
    } else {
      // 兜底：走 cdp.evm 版本，但仍传 smartAccount 对象（不是 address）
      const res = await cdp.evm.sendUserOperation({ smartAccount, network, calls });
      userOpHash = res?.userOpHash;
    }

    if (!userOpHash) {
      return ok({
        ok: false,
        smartAccount: address,
        owner: ownerAddress,
        network,
        error: "userOpHash missing after sendUserOperation",
        debug,
      });
    }

    // 5) 等待完成
    let receipt: any;
    if (hasObjWait) {
      receipt = await smartAccount.waitForUserOperation({ userOpHash });
    } else {
      receipt = await cdp.evm.waitForUserOperation({ smartAccount, userOpHash });
    }

    return ok({
      ok: receipt?.status === "complete",
      deployed: receipt?.status === "complete",
      smartAccount: address,
      owner: ownerAddress,
      network,
      userOpHash,
      // debug, // 若还失败可临时打开返回 debug
    });
  } catch (err: any) {
    // 返回字符串化的错误
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error: String(err?.message || err),
    });
  }
}
