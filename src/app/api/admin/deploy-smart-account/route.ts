// src/app/api/admin/deploy-smart-account/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

export async function GET(req: NextRequest) {
  const token =
    req.headers.get("x-admin-token") ??
    new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const address =
    new URL(req.url).searchParams.get("address") ||
    process.env.SMART_ACCOUNT_ADDRESS;
  if (!address) return ok({ ok: false, error: "missing smart account address" }, 400);

  const network = process.env.NETWORK || "base-mainnet";

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 🔧 强制构造一个“SmartAccount 对象”，至少包含 address 字段
    const sa = { address } as any;

    // 发一笔 0 ETH 自转，触发部署
    const sendRes = await cdp.evm.sendUserOperation({
      smartAccount: sa,               // ✅ 必须传对象（当前 SDK 分支会访问 .address）
      network,
      calls: [{ to: address as `0x${string}`, value: parseEther("0"), data: "0x" }],
    });

    const receipt = await cdp.evm.waitForUserOperation({
      smartAccount: sa,               // ✅ 等待同样传对象
      userOpHash: sendRes.userOpHash,
    });

    return ok({
      ok: receipt?.status === "complete",
      deployed: receipt?.status === "complete",
      smartAccount: address,
      userOpHash: sendRes.userOpHash,
      hint: receipt?.status === "complete"
        ? "Smart Account 已部署。"
        : "已提交 UO，稍后再查。",
    });
  } catch (err: any) {
    return ok({
      ok: false,
      smartAccount: address,
      error: String(err),
      tip: "已把 smartAccount 强制传对象。如果仍失败，请把完整错误返回给我。",
    }, 200);
  }
}
