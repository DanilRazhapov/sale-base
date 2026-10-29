import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const LoginPage = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    
    const navigate = useNavigate();

    async function handleLogIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    
    const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
    })
    
    if (error) {
        alert('Error logging in: ' + error.message);
        return;
    }
    };

    return (
        <div>
            <form onSubmit={handleLogIn}>
            <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
            />
            <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit">Log In</button>
        </form>

        <button onClick={() => navigate('/register')}>Don`t have account?</button>
        </div>
    )
}

export default LoginPage;
