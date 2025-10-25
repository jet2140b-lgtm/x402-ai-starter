export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";

const ok = (data: any, status = 200) => NextResponse.json(data, { status });
const noauth = () => ok({ ok: false, error: "unauthorized" }, 401);

// 列出 Smart Accounts（兼容多版本命名）
async function listSmart(cdp: any) {
  const evm = cdp.evm;
  if (!evm) return { list: [], used: "none" };
  try {
    if (evm.smartWallets?.listAccounts) {
      return { list: await evm.smartWallets.listAccounts(), used: "evm.smartWallets.listAccounts" };
    }
  } catch {}
  try {
    if (evm.listSmartAccounts) {
      return { list: await evm.listSmartAccounts(), used: "evm.listSmartAccounts" };
    }
  } catch {}
  try {
    if (evm.accounts?.listSmartAccounts) {
      return { list: await evm.accounts.listSmartAccounts(), used: "evm.accounts.listSmartAccounts" };
    }
  } catch {}
  return { list: [], used: "none" };
}

// 创建 EOA（作为 owner，兼容多版本命名）
async function createEOA(cdp: any) {
  const evm = cdp.evm;
  if (evm?.createAccount) return await evm.createAccount();
  if (evm?.accounts?.create) return await evm.accounts.create();
  throw new Error("No EOA creator found (evm.createAccount / evm.accounts.create).");
}

// 创建 Smart Account（兼容多版本 & 参数名）
async function createSmart(cdp: any, ownerId?: string, ownerAddress?: string) {
  const evm = cdp.evm;
  const arg = ownerId ? { ownerAccountId: ownerId } : { ownerAddress };

  if (evm?.smartWallets?.createAccount) return await evm.smartWallets.createAccount(arg);
  if (evm?.createSmartAccount) return await evm.createSmartAccount(arg);
  if (evm?.accounts?.createSmartAccount) return await evm.accounts.createSmartAccount(arg);

  throw new Error("No Smart Account creator found.");
}

function extractAddressId(x: any) {
  return {
    address: x?.address ?? x?.smartAccount?.address ?? x?.data?.address ?? x?.result?.address ?? null,
    id: x?.id ?? x?.smartAccount?.id ?? x?.data?.id ?? x?.result?.id ?? null,
  };
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-admin-token") ?? new URL(req.url).searchParams.get("token");
  if (token !== process.env.ADMIN_TOKEN) return noauth();

  try {
    const cdp: any = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_NAME!,
      privateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    });

    // 1) 列旧列表
    const before = await listSmart(cdp);

    // 2) 准备 owner
    let ownerId = process.env.CDP_OWNER_EOA_ID;
    let ownerAddress = process.env.CDP_OWNER_EOA_ADDRESS;
    if (!ownerId && !ownerAddress) {
      const eoa = await createEOA(cdp);
      ownerId = eoa?.id;
      ownerAddress = eoa?.address;
    }

    // 3) 创建
    const raw = await createSmart(cdp, ownerId, ownerAddress);
    const fromRaw = extractAddressId(raw);

    // 4) 列新列表，取差集
    const after = await listSmart(cdp);
    const setBefore = new Set((before.list || []).map((i: any) => (extractAddressId(i).address || "").toLowerCase()));
    const added = (after.list || []).map(extractAddressId).filter((i: any) => i.address && !setBefore.has(i.address.toLowerCase()));

    const final = added[0] || fromRaw;

    return ok({
      ok: !!final.address,
      address: final.address,
      id: final.id,
      used: { listBefore: before.used, listAfter: after.used },
      ownerId,
      ownerAddress,
      raw, // 返回原始创建响应，便于诊断
      hint:
        "若 address 仍为 null，请把响应里的 raw 发我。你也可以先打开 /api/admin/cdp-debug 看看 SDK 可用方法。",
    });
  } catch (err: any) {
    console.error(err);
    return ok({ ok: false, error: String(err) }, 500);
  }
}
