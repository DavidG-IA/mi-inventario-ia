"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [esRegistro, setEsRegistro] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const router = useRouter();

  const handleSubmit = async () => {
    setLoading(true);
    setMensaje("");

    if (esRegistro) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setMensaje("Error: " + error.message);
      else setMensaje("Registro exitoso! Revisa tu correo para confirmar.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMensaje("Error: " + error.message);
      else router.push("/");
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold text-blue-600 mb-6 text-center">
          {esRegistro ? "Crear cuenta" : "Iniciar sesion"}
        </h1>

        <input
          type="email"
          placeholder="Correo electronico"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded-lg p-3 mb-3 text-sm text-gray-900 bg-white"
        />
        <input
          type="password"
          placeholder="Contrasena"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded-lg p-3 mb-4 text-sm text-gray-900 bg-white"
        />

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold"
        >
          {loading ? "Cargando..." : esRegistro ? "Registrarme" : "Entrar"}
        </button>

        {mensaje && (
          <p className="mt-4 text-sm text-center text-gray-600">{mensaje}</p>
        )}

        <p
          onClick={() => setEsRegistro(!esRegistro)}
          className="mt-4 text-center text-sm text-blue-500 cursor-pointer"
        >
          {esRegistro ? "Ya tienes cuenta? Inicia sesion" : "No tienes cuenta? Registrate"}
        </p>
      </div>
    </div>
  );
}