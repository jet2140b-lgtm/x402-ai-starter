// src/app/api/admin/create-smart-account/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

function ok(data: any, status = 200) {
  return NextResponse.json(data, { status });
}
function noauth() {
  return ok({ error: "unauthorized" }, 401);
}

export async function GET(req: NextRequest) {
  // 简单鉴权：请求头或 ?token= 必须带上 ADMIN_TOKEN
  const token =
    req.headers.get("x-admin-token") ??
    new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  try {
    // 初始化 CDP 客户端（Server Wallet v2）
    const cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 不同 SDK 版本创建 Smart Account 的入口名可能不同。
    // 下面做了兼容：优先 smartWallets.createAccount，其次 createSmartAccount。
    const evmAny: any = (cdp as any).evm;
    const creator =
      evmAny?.smartWallets?.createAccount ??
      evmAny?.createSmartAccount ??
      null;

    if (!creator) {
      return ok(
        {
          ok: false,
          error:
            "SDK does not expose Smart Account creator (smartWallets.createAccount / createSmartAccount not found). " +
            "Please upgrade @coinbase/cdp-sdk to the latest.",
        },
        500
      );
    }

    const account = await creator.call(evmAny);
    // account 里一般会包含 address / id
    return ok({
      ok: true,
      type: "smart-account",
      address: account.address,
      id: account.id ?? null,
      hint:
        "Go to Coinbase Developer Platform → Wallets → EVM Smart account tab, you should see this address listed.",
    });
  } catch (err: any) {
    console.error(err);
    return ok({ ok: false, error: String(err) }, 500);
  }
}
