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

    // ✅ 明确指定 owner 对象（用于 Smart Account）
    const owner = { address: process.env.SELLER_ADDRESS || address };
    const sa = { address, owner };

    // ✅ 调用 sendUserOperation，注意 calls 格式
    const sendRes = await cdp.evm.sendUserOperation({
      smartAccount: sa,
      network,
      calls: [
        {
          to: address as `0x${string}`,
          value: parseEther("0"),
          data: "0x", // 必须显式 "0x"
        },
      ],
    });

    // ✅ 等待确认
    const receipt = await cdp.evm.waitForUserOperation({
      smartAccount: sa,
      userOpHash: sendRes.userOpHash,
    });

    return ok({
      ok: receipt?.status === "complete",
      deployed: receipt?.status === "complete",
      smartAccount: address,
      userOpHash: sendRes.userOpHash,
      hint:
        receipt?.status === "complete"
          ? "✅ Smart Account 已成功部署"
          : "已提交 UO，请稍后刷新 Portal 查看。",
    });
  } catch (err: any) {
    return ok({
      ok: false,
      smartAccount: address,
      error: String(err),
      tip: "已添加 owner 和 data 字段。如果仍失败，请保留完整 JSON 报错发给我。",
    });
  }
}
