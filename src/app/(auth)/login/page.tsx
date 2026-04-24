import { redirect } from "next/navigation";
import LoginForm from "@/app/(auth)/login/LoginForm";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";

const LOGIN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_confirm_link: "That confirmation link isn't valid. Sign in or request a new one.",
  confirm_failed: "We couldn't finish verifying your email. Sign in and we'll ask you to resend the link.",
  oauth_failed: "We couldn't sign you in with that provider. Try again or use email.",
  oauth_exchange_failed: "Something went wrong completing sign-in. Please try again.",
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

  return LOGIN_ERROR_MESSAGES[key];
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
