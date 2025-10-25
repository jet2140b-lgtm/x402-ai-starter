export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

const ok = (data: any, status = 200) => NextResponse.json(data, { status });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-admin-token") ?? new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  try {
    const cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    }) as any;

    const evm = cdp.evm;
    const info: any = {
      sdkKeysAtTop: Object.keys(cdp).sort(),
      hasEvm: !!evm,
      evmKeys: evm ? Object.keys(evm).sort() : [],
      evmSmartWalletsKeys: evm?.smartWallets ? Object.keys(evm.smartWallets).sort() : [],
      evmAccountsKeys: evm?.accounts ? Object.keys(evm.accounts).sort() : [],
      notes: [
        "我们会尝试用多种候选 API 列出 EOA 与 Smart Accounts。",
        "把这份 JSON 发给我，我就能精确匹配你这版 SDK 的正确方法名。",
      ],
    };

    const out: any = { ok: true, info };

    // 尝试列出 EOA 账户
    try {
      if (evm?.accounts?.list) {
        out.eoaList = await evm.accounts.list();
      } else if (evm?.listAccounts) {
        out.eoaList = await evm.listAccounts();
      }
    } catch (e: any) {
      out.eoaListError = String(e);
    }

    // 尝试列出 Smart Accounts
    try {
      if (evm?.smartWallets?.listAccounts) {
        out.smartList = await evm.smartWallets.listAccounts();
      } else if (evm?.listSmartAccounts) {
        out.smartList = await evm.listSmartAccounts();
      } else if (evm?.accounts?.listSmartAccounts) {
        out.smartList = await evm.accounts.listSmartAccounts();
      }
    } catch (e: any) {
      out.smartListError = String(e);
    }

    return ok(out);
  } catch (err: any) {
    console.error(err);
    return ok({ ok: false, error: String(err) }, 500);
  }
}
