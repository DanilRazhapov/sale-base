import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type ProtectedRouteProps = {
    children: ReactNode;
};

export function ProtectedRoute({children}: ProtectedRouteProps) {
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);

    useEffect(() => {
        async function checkAccess() {
            try {
                const { data: { user }, error: authError } = await supabase.auth.getUser();

                if (authError || !user) {
                    setAuthorized(false);
                    return;
                }

                const { data: profile, error: profileError } = await supabase
                    .from("profiles")
                    .select("is_active")
                    .eq("id", user.id)
                    .maybeSingle();

                setAuthorized(
                    !profileError &&
                    profile?.is_active === true
                );
            } catch {
                setAuthorized(false);
            } finally {
                setLoading(false)
            }
        }

        checkAccess()
    }, []);

    if (loading) {
        return <div>Access check...</div>
    }

    if (!authorized) {
        return <Navigate to="/login" replace/>;
    }

    return <>{children}</>
}
