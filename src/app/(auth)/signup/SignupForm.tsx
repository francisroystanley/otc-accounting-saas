"use client";

import { useActionState } from "react";
import Link from "next/link";
import { type AuthActionState, signUpAction } from "@/app/actions/auth";
import OAuthButtons from "@/components/auth/OAuthButtons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthActionState = {};

const SignupForm = () => {
  const [state, action, pending] = useActionState(signUpAction, initialState);

  if (state.notice !== undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>{state.notice}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            We sent a confirmation link to <span className="text-foreground font-medium">{state.email}</span>. Click it
            to finish signing up, then sign in here.
          </p>
          <div className="mt-4">
            <Link
              href="/login"
              className="text-foreground text-sm font-medium underline underline-offset-4 hover:no-underline"
            >
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>OTC Accounting — private beta.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <OAuthButtons />
        <div className="flex items-center gap-3 text-xs uppercase" aria-hidden="true">
          <span className="bg-border h-px flex-1" />
          <span className="text-muted-foreground tracking-wider">or continue with email</span>
          <span className="bg-border h-px flex-1" />
        </div>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.email ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          {state.error !== undefined ? (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="text-foreground font-medium underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
};

export default SignupForm;
