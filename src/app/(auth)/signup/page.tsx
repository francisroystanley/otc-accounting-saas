import { redirect } from "next/navigation";
import SignupForm from "@/app/(auth)/signup/SignupForm";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";

const SignupPage = async () => {
  const auth = await getAuthenticatedContext();

  if (auth !== null) {
    redirect("/dashboard");
  }

  return <SignupForm />;
};

export default SignupPage;
