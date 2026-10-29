import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { Link, useLocation } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";

const LoginPage = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const submitting = useRef(false);
    const location = useLocation();

    async function handleLogIn(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true); setErrorMessage("");
        try {
            const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
            if (error) setErrorMessage(error.message);
        } catch { setErrorMessage("Не удалось войти. Проверьте подключение и попробуйте снова."); }
        finally { submitting.current = false; setBusy(false); }
    };

    return (
        <AuthLayout title="С возвращением" description="Войдите, чтобы управлять магазинами и следить за их работой."
            footer={<>Ещё нет аккаунта? <Link to="/register">Зарегистрироваться</Link></>}>
            {location.state?.registered && <p className="app-message app-message-success" role="status">Аккаунт создан. Проверьте почту, если требуется подтверждение регистрации.</p>}
            <form className="app-form" onSubmit={handleLogIn} aria-busy={busy}>
                <fieldset disabled={busy}>
                    <label htmlFor="login-email">Электронная почта<input id="login-email" name="email" autoComplete="email" type="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                    <label htmlFor="login-password">Пароль<input id="login-password" name="password" autoComplete="current-password" type="password" placeholder="Введите пароль" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
                    {errorMessage && <p className="app-message app-message-error" role="alert">{errorMessage}</p>}
                    <button className="app-button app-button-primary app-button-full" type="submit">{busy ? "Входим…" : "Войти в кабинет"}<span aria-hidden="true">→</span></button>
                </fieldset>
            </form>
        </AuthLayout>
    )
}

export default LoginPage;
