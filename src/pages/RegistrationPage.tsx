import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

const RegisterPage = () => {
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const navigate = useNavigate()

    async function handleRegister(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                }
            }
        });

        if (error) {
            alert('Error registering user: ' + error.message);
            return;
        }

        navigate("/login")
    }

    return (
        <div>
            <form onSubmit={handleRegister}> 
                <input 
                    placeholder="Fullname"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                />
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

                <button type="submit">Register</button>
            </form>

            <button onClick={() => navigate('/login')}>Already have an account?</button>
        </div>
    )
}

export default RegisterPage;