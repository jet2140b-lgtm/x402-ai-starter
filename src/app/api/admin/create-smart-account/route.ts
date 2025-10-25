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
    const cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    }) as any;

    // 1) 尝试用 SDK 获取 SmartAccount 对象（某些版本需要对象而不是地址）
    let sa: any = null;
    if (cdp?.evm?.getSmartAccount) {
      // 有的版本需要传 network
      try {
        sa = await cdp.evm.getSmartAccount({ address, network });
      } catch (_) {
        sa = await cdp.evm.getSmartAccount({ address });
      }
    }

    // 2) 发送 0 ETH 的 UO 触发部署（优先用对象，其次用地址）
    const sendArgs: any = {
      network,
      calls: [{ to: address as `0x${string}`, value: parseEther("0"), data: "0x" }],
    };
    if (sa) {
      sendArgs.smartAccount = sa; // ✅ 某些版本必须是对象
    } else {
      sendArgs.smartAccountAddress = address; // 兼容老写法
    }

    const sendRes = await cdp.evm.sendUserOperation(sendArgs);

    // 3) 等待完成（同样优先对象，降级地址）
    const waitArgs: any = { userOpHash: sendRes.userOpHash };
    if (sa) {
      waitArgs.smartAccount = sa;
    } else {
      waitArgs.smartAccountAddress = address;
    }

    const receipt = await cdp.evm.waitForUserOperation(waitArgs);

    return ok({
      ok: receipt?.status === "complete",
      smartAccount: address,
      userOpHash: sendRes.userOpHash,
      deployed: receipt?.status === "complete",
      hint:
        receipt?.status === "complete"
          ? "Smart Account 已部署。"
          : "已提交 UO，稍后再查。",
    });
  } catch (err: any) {
    return ok(
      {
        ok: false,
        smartAccount: address,
        error: String(err),
        tip:
          "如果仍报错，请确保该地址里有 ≥0.01 Base ETH（或开启 Gas Sponsorship），并确认 @coinbase/cdp-sdk 已升级为最新。",
      },
      200
    );
  }
}
