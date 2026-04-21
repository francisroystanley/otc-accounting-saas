"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getPublicBaseUrl } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type AuthActionState = {
  error?: string;
  email?: string;
  notice?: string;
};

const readEmailFromForm = (formData: FormData): string => {
  const raw = formData.get("email");

  return typeof raw === "string" ? raw : "";
};

const readCredentials = (formData: FormData): { email: string; password: string } | { error: string } => {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid credentials" };
  }

  return parsed.data;
};

const resolveConfirmRedirectUrl = (): string | null => {
  const base = getPublicBaseUrl();

  return base === null ? null : `${base}/auth/confirm`;
};

export const signInAction = async (_prev: AuthActionState, formData: FormData): Promise<AuthActionState> => {
  const result = readCredentials(formData);

  if ("error" in result) {
    return { error: result.error, email: readEmailFromForm(formData) };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: result.email,
    password: result.password,
  });

  if (error !== null) {
    return { error: error.message, email: result.email };
  }

  redirect("/dashboard");
};

export const signUpAction = async (_prev: AuthActionState, formData: FormData): Promise<AuthActionState> => {
  const result = readCredentials(formData);

  if ("error" in result) {
    return { error: result.error, email: readEmailFromForm(formData) };
  }

  const supabase = await createSupabaseServerClient();
  const emailRedirectTo = resolveConfirmRedirectUrl();
  const { error } = await supabase.auth.signUp({
    email: result.email,
    password: result.password,
    options: emailRedirectTo === null ? undefined : { emailRedirectTo },
  });

  if (error !== null) {
    return { error: error.message, email: result.email };
  }

  return {
    notice: "Check your inbox to confirm your email, then return here to sign in.",
    email: result.email,
  };
};

export const signOutAction = async (): Promise<void> => {
  const supabase = await createSupabaseServerClient();

  await supabase.auth.signOut();

  redirect("/login");
};
