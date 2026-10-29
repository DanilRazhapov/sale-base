import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";

const RegisterPage = () => {
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [busy, setBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const submitting = useRef(false);
    const navigate = useNavigate();

    async function handleRegister(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (submitting.current) return;
        if (!fullName.trim()) { setErrorMessage("Введите ваше имя."); return; }
        submitting.current = true;
        setBusy(true); setErrorMessage("");
        try {
            const { error } = await supabase.auth.signUp({
                email: email.trim(),
                password,
                options: {
                    data: {
                        full_name: fullName.trim(),
                    }
                }
            });

            if (error) {
                setErrorMessage(error.message);
                return;
            }

            navigate("/login", { state: { registered: true } });
        } catch { setErrorMessage("Не удалось создать аккаунт. Проверьте подключение и попробуйте снова."); }
        finally { submitting.current = false; setBusy(false); }
    }

    return (
        <AuthLayout title="Создайте аккаунт" description="Начните с регистрации — затем добавьте магазин и кассиров."
            footer={<>Уже зарегистрированы? <Link to="/login">Войти в кабинет</Link></>}>
            <form className="app-form" onSubmit={handleRegister} aria-busy={busy}>
                <fieldset disabled={busy}>
                    <label htmlFor="register-name">Ваше имя<input id="register-name" name="name" autoComplete="name" placeholder="Как к вам обращаться" maxLength={120} required value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
                    <label htmlFor="register-email">Электронная почта<input id="register-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                    <label htmlFor="register-password">Пароль<input id="register-password" name="password" type="password" autoComplete="new-password" placeholder="Придумайте пароль" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
                    {errorMessage && <p className="app-message app-message-error" role="alert">{errorMessage}</p>}
                    <button className="app-button app-button-primary app-button-full" type="submit">{busy ? "Создаём аккаунт…" : "Создать аккаунт"}<span aria-hidden="true">→</span></button>
                </fieldset>
            </form>
        </AuthLayout>
    )
}

export default RegisterPage;
