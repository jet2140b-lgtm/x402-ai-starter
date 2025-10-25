export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

const ok = (data: any, status = 200) =>
  NextResponse.json(data, { status });
const noauth = () => ok({ error: "unauthorized" }, 401);

export async function GET(req: NextRequest) {
  // 简单鉴权：header 或 ?token=
  const token =
    req.headers.get("x-admin-token") ??
    new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  try {
    const cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    const evm: any = (cdp as any).evm;

    let account: any | null = null;

    // ✅ 正确的、带“所属对象”的调用方式（保持 this 上下文）
    if (evm?.smartWallets?.createAccount) {
      account = await evm.smartWallets.createAccount();
    } else if (evm?.createSmartAccount) {
      account = await evm.createSmartAccount();
    } else if (evm?.accounts?.createSmartAccount) {
      // 某些旧/新版本可能挂在其他命名空间，做个兜底
      account = await evm.accounts.createSmartAccount();
    } else {
      return ok(
        {
          ok: false,
          error:
            "SDK 中未找到创建 Smart Account 的方法。请将 @coinbase/cdp-sdk 升级到最新，或确认 v2 Server Wallet 文档对应的方法名（如 evm.smartWallets.createAccount / evm.createSmartAccount）。",
        },
        500
      );
    }

    return ok({
      ok: true,
      type: "smart-account",
      address: account?.address ?? null,
      id: account?.id ?? null,
      hint:
        "去 Coinbase Developer Platform → Wallets → EVM Smart account 标签页查看是否出现该地址。",
    });
  } catch (err: any) {
    console.error(err);
    return ok({ ok: false, error: String(err) }, 500);
  }
}
