import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";

const RootPage = async (): Promise<never> => {
  const auth = await getAuthenticatedContext();

  redirect(auth === null ? "/login" : "/dashboard");
};

export default RootPage;
