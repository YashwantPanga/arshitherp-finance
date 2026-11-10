import { NextRequest } from "next/server";
import { dispatch } from "lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };
export async function GET(req: NextRequest, ctx: Ctx) { return dispatch(req, (await ctx.params).path ?? []); }
export async function POST(req: NextRequest, ctx: Ctx) { return dispatch(req, (await ctx.params).path ?? []); }
export async function PUT(req: NextRequest, ctx: Ctx) { return dispatch(req, (await ctx.params).path ?? []); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return dispatch(req, (await ctx.params).path ?? []); }
