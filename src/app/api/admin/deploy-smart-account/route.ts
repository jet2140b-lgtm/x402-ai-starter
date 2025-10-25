export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther } from "viem";

const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = req.headers.get("x-admin-token") ?? url.searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  // 允许用 query 指定要部署的 SA；否则读环境变量
  const address =
    url.searchParams.get("address") || process.env.SMART_ACCOUNT_ADDRESS;
  if (!address) return ok({ ok: false, error: "missing smart account address" }, 400);

  const ownerAddress =
    process.env.CDP_OWNER_EOA_ADDRESS || url.searchParams.get("owner"); // 固定 owner
  if (!ownerAddress) return ok({ ok: false, error: "missing owner (CDP_OWNER_EOA_ADDRESS)" }, 400);

  const network = process.env.NETWORK || "base-mainnet";

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 按文档要求：传 smartAccount 对象（含 owner）
    const smartAccount = { address, owner: { address: ownerAddress } };

    // 一笔 0 ETH 自转 → 触发部署
    const sendArgs = {
      smartAccount,
      network,
      calls: [
        {
          to: ownerAddress as `0x${string}`,
          value: parseEther("0"),
          data: "0x",
        },
      ],
    };

    // 输出调试信息（返回给你看）
    const debug: any = { step: "sendUserOperation", sendArgs: { ...sendArgs, smartAccount } };

    let userOp: any = null;
    try {
      const sendRes = await cdp.evm.sendUserOperation(sendArgs);
      debug.sent = sendRes;
      userOp = await cdp.evm.waitForUserOperation({
        smartAccount,
        userOpHash: sendRes.userOpHash,
      });
      debug.waited = userOp;
    } catch (e: any) {
      // 尽量把底层错误细节带出来
      return ok({
        ok: false,
        smartAccount: address,
        owner: ownerAddress,
        network,
        error: String(e?.message || e),
        stack: e?.stack || null,
        cause: e?.cause ? String(e.cause) : null,
        responseData: e?.response?.data || null,
        debug,
        tip: "若 error 显示余额不足，请把 SA 里提高到 ≥0.015 ETH 再试；若是权限/策略错误，需要在 CDP Portal 打开 Server Wallets v2 Smart Accounts / Sponsorship。",
      }, 200);
    }

    const deployed = userOp?.status === "complete";
    return ok({
      ok: deployed,
      deployed,
      network,
      smartAccount: address,
      owner: ownerAddress,
      userOpHash: userOp?.userOpHash || debug?.sent?.userOpHash,
      receipt: userOp || null,
      hint: deployed
        ? "✅ 部署完成；Portal 的 Smart account 栏应可见。"
        : "已广播 UO，请稍后刷新 Portal。",
    });
  } catch (err: any) {
    // 不再返回 500，避免你看不到原因
    return ok({
      ok: false,
      smartAccount: address,
      owner: ownerAddress,
      network,
      error: String(err?.message || err),
      stack: err?.stack || null,
      tip: "查看 Functions Logs；确认环境变量与网络一致。",
    }, 200);
  }
}
