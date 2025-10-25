export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

// 将对象中的 BigInt 转成字符串，避免 Response.json 序列化报错
function safeJson(data: any, status = 200) {
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { status, headers: { "content-type": "application/json" } });
}
const ok = (d: any, s = 200) => safeJson(d, s);
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = req.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  const address = url.searchParams.get("address") || process.env.SMART_ACCOUNT_ADDRESS;
  if (!address) return ok({ ok: false, error: "missing smart account address" }, 400);

  const ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS || url.searchParams.get("owner");
  if (!ownerAddress) return ok({ ok: false, error: "missing owner (CDP_OWNER_EOA_ADDRESS)" }, 400);

  const network = process.env.NETWORK || "base-mainnet"; // ← 用 base-mainnet 或 base-sepolia

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 按文档：传 smartAccount 对象（含 owner）
    const smartAccount = { address, owner: { address: ownerAddress } };

    // 0 ETH 自转，触发部署；注意 parseEther 返回 bigint，我们只把它用于 SDK 调用，不放进响应体
    const sendRes = await cdp.evm.sendUserOperation({
      smartAccount,
      network,
      calls: [{ to: ownerAddress as `0x${string}`, value: parseEther("0"), data: "0x" }],
    });

    const receipt = await cdp.evm.waitForUserOperation({
      smartAccount,
      userOpHash: sendRes.userOpHash,
    });

    const deployed = receipt?.status === "complete";
    return ok({
      ok: deployed,
      deployed,
      network,
      smartAccount: address,
      owner: ownerAddress,
      userOpHash: sendRes.userOpHash, // 纯字符串
    });
  } catch (err: any) {
    // 不返回包含 BigInt 的原始对象；仅返回字符串化的错误信息
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error: String(err?.message || err),
    });
  }
}
