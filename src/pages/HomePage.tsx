import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";

function HomePage() {
    const [session, setSession] = useState<Session | null>(null)

    const navigate = useNavigate();

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => setSession(data.session))
    }, []);

    async function handleLogOut() {
        await supabase.auth.signOut();
    }

    if (!session) return <div>Download...</div>

    return (
        <div>
            <h1>Home Page</h1>
            <p>You join like {session.user.email}</p>
            <button onClick={handleLogOut}>Log Out</button>
            
            <button onClick={() => navigate('/owner')}>On Admin Page</button>
            <button onClick={() => navigate('/store/new')}>Создать магазин</button>
        </div>
    )
}

export default HomePage;
