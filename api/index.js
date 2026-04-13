<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>juteach.org — Tecnología & Educación</title>
    <style>
        :root {
            --primary: #1D9E75;
            --primary-dark: #085041;
            --bg: #ffffff;
            --text: #333333;
            --text-light: #666666;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            overflow: hidden;
        }

        /* Fondo sutil con gradiente */
        body::before {
            content: "";
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: radial-gradient(circle at 10% 20%, rgba(29, 158, 117, 0.05) 0%, transparent 50%),
                        radial-gradient(circle at 90% 80%, rgba(8, 80, 65, 0.05) 0%, transparent 50%);
            z-index: -1;
        }

        .container {
            text-align: center;
            padding: 2rem;
            max-width: 600px;
            animation: fadeIn 1s ease-out;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .logo {
            font-size: 1.2rem;
            font-weight: 700;
            color: var(--primary);
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-bottom: 2rem;
            display: inline-block;
        }

        h1 {
            font-size: 2.5rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: var(--primary-dark);
            line-height: 1.2;
        }

        p {
            font-size: 1.1rem;
            color: var(--text-light);
            line-height: 1.6;
            margin-bottom: 2.5rem;
        }

        .services {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
            align-items: center;
        }

        /* El enlace principal */
        .btn-acortador {
            text-decoration: none;
            color: white;
            background-color: var(--primary);
            padding: 14px 32px;
            border-radius: 50px;
            font-weight: 500;
            font-size: 1rem;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(29, 158, 117, 0.3);
            display: inline-flex;
            align-items: center;
            gap: 10px;
        }

        .btn-acortador:hover {
            background-color: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(8, 80, 65, 0.4);
        }

        .coming-soon {
            font-size: 0.9rem;
            color: #aaa;
            font-style: italic;
            margin-top: 1rem;
        }

        footer {
            position: absolute;
            bottom: 2rem;
            font-size: 0.8rem;
            color: #ccc;
        }

        /* Responsive */
        @media (max-width: 480px) {
            h1 { font-size: 1.8rem; }
            p { font-size: 1rem; }
        }
    </style>
</head>
<body>

    <div class="container">
        <div class="logo">juteach.org</div>
        
        <h1>Tecnología, Educación <br>& Soluciones Digitales</h1>
        
        <p>
            Estamos construyendo un espacio para potenciar el aprendizaje y la gestión tecnológica. 
            Por ahora, puedes utilizar nuestra herramienta profesional de:
        </p>

        <div class="services">
            <a href="/Acortador" class="btn-acortador">
                <span>Acortador de Enlaces & QR</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
            
            <div class="coming-soon">
                Próximamente: Más herramientas y recursos educativos.
            </div>
        </div>
    </div>

    <footer>
        &copy; 2026 juteach.org | Bogotá, Colombia
    </footer>

</body>
</html>
