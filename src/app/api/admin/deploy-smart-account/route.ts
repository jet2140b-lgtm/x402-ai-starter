export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

// 兼容 BigInt 的 JSON
function safeJson(data: any, status = 200) {
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { status, headers: { "content-type": "application/json" } });
}
const ok = (d: any, s = 200) => safeJson(d, s);
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

// 将项目里的 NETWORK（base | base-sepolia）映射为 CDP 的网络名
function getCdpNetwork() {
  const raw = process.env.NETWORK || "base";
  return raw === "base" ? "base-mainnet" : raw; // base -> base-mainnet
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = req.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const address = url.searchParams.get("address") || process.env.SMART_ACCOUNT_ADDRESS;
  if (!address) return ok({ ok: false, error: "missing smart account address" }, 400);

  const ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS;
  if (!ownerAddress) return ok({ ok: false, error: "missing owner (CDP_OWNER_EOA_ADDRESS)" }, 400);

  const network = getCdpNetwork();

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 必须传 smartAccount 对象（含 owner），兼容你的 SDK 分支
    const smartAccount = { address, owner: { address: ownerAddress } };

    // 发一笔 0 ETH 自转来触发部署
    const sendRes = await cdp.evm.sendUserOperation({
      smartAccount,
      network,
      calls: [{ to: ownerAddress as `0x${string}`, value: parseEther("0"), data: "0x" }],
    });

    const receipt = await cdp.evm.waitForUserOperation({
      smartAccount,
      userOpHash: sendRes.userOpHash,
    });

    return ok({
      ok: receipt?.status === "complete",
      deployed: receipt?.status === "complete",
      network, // 已映射后的真实网络名
      smartAccount: address,
      owner: ownerAddress,
      userOpHash: sendRes.userOpHash,
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
