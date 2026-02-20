"use client";
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { v4 as uuidv4 } from 'uuid';

const COSTO_POR_FOTO = 30;

export default function InventarioIA() {
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<any[]>([]);
  const [historial, setHistorial] = useState<any[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [nombreManual, setNombreManual] = useState("");
  const [usuario, setUsuario] = useState<any>(null);
  const [verificando, setVerificando] = useState(true);
  const [guardadoExito, setGuardadoExito] = useState(false);
  const [editandoIndex, setEditandoIndex] = useState<number | null>(null);
  const [nombreEditado, setNombreEditado] = useState<string>("");
  const [tokens, setTokens] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const router = useRouter();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session) {
          setUsuario(session.user);
          cargarHistorial(session.user.email ?? "");
          cargarOCrearTokens(session.user.email ?? "");
        } else {
          setUsuario(null);
          apagarCamara();
          router.push("/login");
        }
        setVerificando(false);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  const cargarOCrearTokens = async (email: string) => {
    const { data, error } = await supabase
      .from('tokens')
      .select('saldo')
      .eq('usuario_email', email)
      .single();

    if (error || !data) {
      // Usuario nuevo — crear registro con 90 tokens
      const { data: nuevo } = await supabase
        .from('tokens')
        .insert({ usuario_email: email, saldo: 1500 })
        .select('saldo')
        .single();
      if (nuevo) setTokens(nuevo.saldo);
    } else {
      setTokens(data.saldo);
    }
  };

  const descontarTokens = async (email: string) => {
    const { data } = await supabase
      .from('tokens')
      .select('saldo')
      .eq('usuario_email', email)
      .single();

    if (!data) return false;

    const nuevoSaldo = data.saldo - COSTO_POR_FOTO;
    if (nuevoSaldo < 0) return false;

    const { error } = await supabase
      .from('tokens')
      .update({ saldo: nuevoSaldo })
      .eq('usuario_email', email);

    if (!error) {
      setTokens(nuevoSaldo);
      return true;
    }
    return false;
  };

  const cargarHistorial = async (email: string) => {
    const { data, error } = await supabase
      .from('inventario')
      .select('*')
      .eq('usuario_email', email)
      .order('fecha', { ascending: false })
      .limit(50);
    if (!error && data) setHistorial(data);
  };

  const apagarCamara = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const cerrarSesion = async () => {
    apagarCamara();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const encenderCamara = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Error al acceder a la camara.");
    }
  };

  const analizarInventario = async () => {
    if (tokens !== null && tokens < COSTO_POR_FOTO) {
      alert("No tienes suficientes tokens. Cada analisis cuesta 30 tokens. Recarga tu cuenta para continuar.");
      return;
    }

    setLoading(true);
    setResultado([]);
    setGuardadoExito(false);
    const desconto = await descontarTokens(usuario.email);
if (!desconto) {
  alert("No tienes suficientes tokens. Recarga tu cuenta.");
  setLoading(false);
  return;
}

    // Descontar tokens ANTES de analizar
    
    const API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    if (canvasRef.current && videoRef.current) {
      const context = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context?.drawImage(videoRef.current, 0, 0);
      const base64Image = canvasRef.current.toDataURL('image/jpeg').split(',')[1];
      const promptNombre = nombreManual
        ? `El producto se llama "${nombreManual}". Cuenta cuantos hay.`
        : "Identifica y cuenta los productos.";
      const prompt = `${promptNombre} Devuelve SOLO JSON: [{"producto": "nombre", "cantidad": numero}]`;
      try {
        const result = await model.generateContent([
          prompt,
          { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
        ]);
        const text = result.response.text().replace(/```json|```/g, "");
        setResultado(JSON.parse(text));
      } catch (error: any) {
        alert("Error: " + error.message);
      }
    }
    setLoading(false);
  };

  const guardarEdicion = (index: number) => {
    const nuevo = [...resultado];
    nuevo[index].producto = nombreEditado;
    setResultado(nuevo);
    setEditandoIndex(null);
    setNombreEditado("");
  };

  const subirFoto = async (): Promise<string> => {
    if (!canvasRef.current) return "";
    return new Promise((resolve) => {
      canvasRef.current!.toBlob(async (blob) => {
        if (!blob) { resolve(""); return; }
        const nombreArchivo = `${uuidv4()}.jpg`;
        const { error } = await supabase.storage
          .from('fotos-inventario')
          .upload(nombreArchivo, blob, { contentType: 'image/jpeg' });
        if (error) { resolve(""); return; }
        const { data } = supabase.storage
          .from('fotos-inventario')
          .getPublicUrl(nombreArchivo);
        resolve(data.publicUrl);
      }, 'image/jpeg', 0.7);
    });
  };

  const guardarEnBase = async () => {
    setGuardando(true);

   

    const foto_url = await subirFoto();
    const registros = resultado.map(item => ({
      usuario_email: usuario.email,
      nombre_producto: item.producto,
      cantidad: item.cantidad,
      foto_url: foto_url
    }));
    const { error } = await supabase.from('inventario').insert(registros);
    if (error) {
      alert("Error al guardar: " + error.message);
    } else {
      setGuardadoExito(true);
      setResultado([]);
      setNombreManual("");
      cargarHistorial(usuario.email);
    }
    setGuardando(false);
  };

  const toggleSeleccion = (id: string) => {
    const nuevo = new Set(seleccionados);
    if (nuevo.has(id)) nuevo.delete(id);
    else nuevo.add(id);
    setSeleccionados(nuevo);
  };

  const seleccionarTodos = () => {
    setSeleccionados(new Set(historial.map(item => item.id)));
  };

  const deseleccionarTodos = () => {
    setSeleccionados(new Set());
  };

  const exportarExcel = () => {
    const registrosAExportar = historial.filter(item => seleccionados.has(item.id));
    if (registrosAExportar.length === 0) {
      alert("Selecciona al menos un registro para exportar.");
      return;
    }
    const datos = registrosAExportar.map(item => ({
      'Producto': item.nombre_producto,
      'Cantidad': item.cantidad,
      'Usuario': item.usuario_email,
      'Fecha': new Date(item.fecha).toLocaleString('es-CO'),
      'Foto URL': item.foto_url || 'Sin foto',
    }));
    const hoja = XLSX.utils.json_to_sheet(datos);
    hoja['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 30 }, { wch: 22 }, { wch: 60 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Inventario");
    const excelBuffer = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });
    saveAs(blob, `inventario_${new Date().toLocaleDateString('es-CO').replace(/\//g, '-')}.xlsx`);
  };

  if (verificando) return (
    <div className="flex items-center justify-center min-h-screen">Cargando...</div>
  );

  if (!usuario) return null;

  const todosSeleccionados = historial.length > 0 && seleccionados.size === historial.length;

  return (
    <div className="flex flex-col items-center p-4 min-h-screen bg-gray-100 font-sans">
      <div className="w-full max-w-md flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-blue-600">Mi Inventario IA</h1>
        <div className="text-right">
          <p className="text-xs text-gray-500">{usuario.email}</p>
          {tokens !== null && (
            <p className={`text-xs font-bold ${tokens < 30 ? 'text-red-500' : 'text-green-600'}`}>
              Tokens: {tokens}
            </p>
          )}
          <button onClick={cerrarSesion} className="text-xs text-red-500">Cerrar sesion</button>
        </div>
      </div>

      <div className="w-full max-w-md mb-3">
        <input
          type="text"
          placeholder="Nombre del producto (opcional)"
          value={nombreManual}
          onChange={(e) => setNombreManual(e.target.value)}
          className="w-full border rounded-lg p-3 text-sm bg-white text-gray-900 placeholder-gray-500"
        />
      </div>

      <div className="relative w-full max-w-md bg-black rounded-lg overflow-hidden shadow-xl mb-4">
        <video ref={videoRef} autoPlay playsInline className="w-full h-64 object-cover" />
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={encenderCamara} className="bg-gray-800 text-white px-4 py-2 rounded-lg">
          Encender Camara
        </button>
        <button onClick={apagarCamara} className="bg-red-700 text-white px-4 py-2 rounded-lg">
          Apagar Camara
        </button>
        <button onClick={analizarInventario} disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded-lg">
          {loading ? "Contando..." : "Contar"}
        </button>
      </div>

      {tokens !== null && tokens < 30 && (
        <div className="w-full max-w-md bg-red-50 border border-red-300 text-red-700 p-3 rounded-lg text-sm text-center mb-4">
          No tienes tokens suficientes. Recarga tu cuenta para continuar.
        </div>
      )}

      {resultado.length > 0 && (
        <div className="w-full max-w-md bg-white p-4 rounded-lg shadow mb-4">
          <h2 className="font-semibold border-b mb-2 text-gray-900">Confirmar resultados:</h2>
          <p className="text-xs text-gray-500 mb-2">Tokens descontados al analizar. Saldo actual: {tokens}</p>
          {resultado.map((item, i) => (
            <div key={i} className="py-2 border-b last:border-0">
              {editandoIndex === i ? (
                <div className="flex gap-2">
                  <input
                    value={nombreEditado}
                    onChange={(e) => setNombreEditado(e.target.value)}
                    className="flex-1 border rounded p-1 text-sm"
                    autoFocus
                  />
                  <button onClick={() => guardarEdicion(i)} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">OK</button>
                  <button onClick={() => setEditandoIndex(null)} className="bg-gray-300 px-3 py-1 rounded text-sm">X</button>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <span className="text-gray-900">{item.producto}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-blue-600">x{item.cantidad}</span>
                    <button
                      onClick={() => { setEditandoIndex(i); setNombreEditado(item.producto); }}
                      className="text-xs bg-gray-200 text-gray-800 px-2 py-1 rounded"
                    >
                      editar
                    </button>
                    <button
                      onClick={() => setResultado(resultado.filter((_, idx) => idx !== i))}
                      className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded"
                    >
                      borrar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <button onClick={guardarEnBase} disabled={guardando} className="w-full mt-4 bg-green-600 text-white py-2 rounded-lg font-semibold">
            {guardando ? "Guardando..." : "Confirmar y Guardar"}
          </button>
          <button onClick={() => setResultado([])} className="w-full mt-2 bg-gray-200 text-gray-800 py-2 rounded-lg text-sm">
            Cancelar
          </button>
        </div>
      )}

      {guardadoExito && (
        <div className="w-full max-w-md bg-green-100 border border-green-400 text-green-700 p-4 rounded-lg text-center mb-4">
          Inventario guardado correctamente
        </div>
      )}

      {historial.length > 0 && (
        <div className="w-full max-w-md bg-white p-4 rounded-lg shadow">
          <div className="flex justify-between items-center border-b mb-2 pb-2">
            <h2 className="font-semibold text-gray-900">Historial reciente</h2>
            <button onClick={exportarExcel} className="bg-green-700 text-white px-3 py-1 rounded text-sm">
              Exportar ({seleccionados.size})
            </button>
          </div>
          <div className="flex gap-2 mb-3">
            <button onClick={todosSeleccionados ? deseleccionarTodos : seleccionarTodos} className="text-xs text-blue-600 underline">
              {todosSeleccionados ? "Deseleccionar todos" : "Seleccionar todos"}
            </button>
            <span className="text-xs text-gray-400">{seleccionados.size} seleccionados</span>
          </div>
          {historial.slice(0, 10).map((item) => (
            <div
              key={item.id}
              onClick={() => toggleSeleccion(item.id)}
              className={`flex justify-between items-center py-2 border-b last:border-0 text-sm cursor-pointer rounded px-2 ${seleccionados.has(item.id) ? 'bg-blue-50' : 'bg-white'} text-gray-900`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={seleccionados.has(item.id)}
                  onChange={() => toggleSeleccion(item.id)}
                  className="cursor-pointer"
                />
                <span>{item.nombre_producto}</span>
              </div>
              <div className="flex gap-3 items-center text-gray-500">
                <span className="font-bold text-blue-600">x{item.cantidad}</span>
                <span>{new Date(item.fecha).toLocaleDateString('es-CO')}</span>
                {item.foto_url && (
                  <span
                    onClick={(e) => { e.stopPropagation(); window.open(item.foto_url, '_blank'); }}
                    className="text-blue-500 text-xs underline cursor-pointer"
                  >
                    ver foto
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}