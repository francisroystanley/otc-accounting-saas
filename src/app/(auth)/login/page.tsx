import { redirect } from "next/navigation";
import LoginForm from "@/app/(auth)/login/LoginForm";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";

const CONFIRM_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_confirm_link: "That confirmation link isn't valid. Sign in or request a new one.",
  confirm_failed: "We couldn't finish verifying your email. Sign in and we'll ask you to resend the link.",
};

type LoginPageProps = {
  searchParams?: Promise<{ error?: string | string[] }>;
};

const readErrorMessage = (value: string | string[] | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const key = Array.isArray(value) ? value[0] : value;

  if (key === undefined) {
    return undefined;
  }

  return CONFIRM_ERROR_MESSAGES[key];
};

const LoginPage = async ({ searchParams }: LoginPageProps) => {
  const auth = await getAuthenticatedContext();

  if (auth !== null) {
    redirect("/dashboard");
  }

  const resolved = searchParams === undefined ? undefined : await searchParams;
  const initialError = readErrorMessage(resolved?.error);

  return <LoginForm initialError={initialError} />;
};

export default LoginPage;
