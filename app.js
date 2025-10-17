const axios = require('axios');
const chalk = require('chalk');
const { exec, spawn } = require('child_process');
const extract = require('extract-zip');
const fs = require('fs');
const inquirer = require('inquirer');
const path = require('path');
const dns = require('dns');
const { promisify } = require('util');

// Configuracion
const ytdlpUrl =
	'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const ffmpegUrl =
	'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
const scriptDirectory = __dirname;

// Rutas
const ytdlpPath = path.join(scriptDirectory, 'yt-dlp.exe');
const ffmpegDir = path.join(scriptDirectory, 'ffmpeg');
const ffmpegBinDir = path.join(ffmpegDir, 'bin');
const ffmpegExePath = path.join(ffmpegBinDir, 'ffmpeg.exe');

let ffmpegAvailable = false;

// --- Funciones de Utilidad ---

const writeColor = (message, color = 'white') =>
	console.log(chalk[color](message));
const writeProgress = message =>
	console.log(chalk.cyan(`[${new Date().toLocaleTimeString()}] ${message}`));
const execPromise = promisify(exec);


const historyFilePath = path.join(scriptDirectory, 'download_history.json');

function readHistory() {
    try {
        if (fs.existsSync(historyFilePath)) {
            const data = fs.readFileSync(historyFilePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        writeColor(`Error al leer el historial: ${error.message}`, 'yellow');
    }
    return [];
}

function writeHistory(paths) {
    try {
        fs.writeFileSync(historyFilePath, JSON.stringify(paths, null, 2));
    } catch (error) {
        writeColor(`Error al guardar el historial: ${error.message}`, 'yellow');
    }
}

function addToHistory(newPath) {
    if (!newPath || newPath.trim() === '.') return; // Do not save empty or current dir alias
    
    const resolvedPath = path.resolve(newPath);

    let history = readHistory();
    // Remove if it already exists to move it to the top
    const index = history.indexOf(resolvedPath);
    if (index > -1) {
        history.splice(index, 1);
    }

    history.unshift(resolvedPath);
    history = history.slice(0, 10); // Keep last 10
    writeHistory(history);
}

async function getUserConfirmation(prompt) {
	const { confirmation } = await inquirer.prompt([
		{
			type: 'confirm',
			name: 'confirmation',
			message: prompt,
			default: true,
		},
	]);
	return confirmation;
}

function testInternetConnection() {
	return new Promise(resolve => {
		dns.lookup('github.com', err => {
			resolve(!err);
		});
	});
}

async function safeDownload(url, outputPath, retries = 3) {
	for (let i = 1; i <= retries; i++) {
		try {
			writeProgress(`Descargando... (Intento ${i} de ${retries})`);
			const response = await axios({
				url,
				method: 'GET',
				responseType: 'stream',
				headers: { 'User-Agent': 'Node.js' },
			});
			const writer = fs.createWriteStream(outputPath);
			response.data.pipe(writer);
			await new Promise((resolve, reject) => {
				writer.on('finish', resolve);
				writer.on('error', reject);
			});
			if (fs.existsSync(outputPath)) return true;
		} catch (error) {
			writeColor(`Error en intento ${i}: ${error.message}`, 'yellow');
			if (i === retries) return false;
			await new Promise(res => setTimeout(res, 2000));
		}
	}
	return false;
}

async function updateYtdlp() {
	if (!fs.existsSync(ytdlpPath)) return;
	writeProgress('Verificando actualizaciones de yt-dlp...');
	try {
		await execPromise(`"${ytdlpPath}" -U`);
		writeColor('yt-dlp está actualizado', 'green');
	} catch (error) {
		writeColor(
			`No se pudo verificar actualizaciones: ${error.message}`,
			'yellow'
		);
	}
}

function testFFmpegComplete() {
	const requiredFiles = ['ffmpeg.exe', 'ffprobe.exe', 'ffplay.exe'];
	return requiredFiles.filter(
		file => !fs.existsSync(path.join(ffmpegBinDir, file))
	);
}

async function installFFmpeg() {
	writeColor('Descargando FFmpeg...', 'yellow');
	const ffmpegZip = path.join(scriptDirectory, 'ffmpeg.zip');

	if (!(await safeDownload(ffmpegUrl, ffmpegZip))) {
		writeColor('ERROR: No se pudo descargar FFmpeg', 'red');
		return false;
	}

	writeColor('Descomprimiendo FFmpeg...', 'yellow');
	const tempDir = path.join(scriptDirectory, 'ffmpeg_temp');
	if (fs.existsSync(tempDir))
		fs.rmSync(tempDir, { recursive: true, force: true });
	fs.mkdirSync(tempDir, { recursive: true });

	try {
		await extract(ffmpegZip, { dir: tempDir });

		const binSourceDir = findDir(tempDir, 'bin');
		if (!binSourceDir) {
			writeColor('ERROR: No se encontró el directorio bin de FFmpeg', 'red');
			return false;
		}

		if (!fs.existsSync(ffmpegBinDir))
			fs.mkdirSync(ffmpegBinDir, { recursive: true });

		const ffmpegFiles = ['ffmpeg.exe', 'ffprobe.exe', 'ffplay.exe'];
		let copiedFiles = 0;
		ffmpegFiles.forEach(file => {
			const sourceFile = path.join(binSourceDir, file);
			if (fs.existsSync(sourceFile)) {
				fs.copyFileSync(sourceFile, path.join(ffmpegBinDir, file));
				copiedFiles++;
				writeColor(`  ✓ ${file} copiado`, 'green');
			} else {
				writeColor(`  ✗ ${file} no encontrado en el paquete`, 'yellow');
			}
		});

		if (copiedFiles > 0) {
			writeColor(
				`FFmpeg instalado correctamente (${copiedFiles} de ${ffmpegFiles.length} archivos)`,
				'green'
			);
			return true;
		} else {
			writeColor('ERROR: No se pudieron copiar los archivos de FFmpeg', 'red');
			return false;
		}
	} catch (error) {
		writeColor(`ERROR durante la extracción: ${error.message}`, 'red');
		return false;
	} finally {
		if (fs.existsSync(tempDir))
			fs.rmSync(tempDir, { recursive: true, force: true });
		if (fs.existsSync(ffmpegZip)) fs.unlinkSync(ffmpegZip);
	}
}

// Helper para encontrar un directorio recursivamente
function findDir(startPath, filter) {
	const files = fs.readdirSync(startPath);
	for (let i = 0; i < files.length; i++) {
		const filename = path.join(startPath, files[i]);
		const stat = fs.lstatSync(filename);
		if (stat.isDirectory()) {
			if (path.basename(filename) === filter) {
				return filename;
			}
			const found = findDir(filename, filter);
			if (found) return found;
		}
	}
}

async function testFFmpegFunctional() {
	if (!ffmpegAvailable) return false;
	try {
		await execPromise(`"${ffmpegExePath}" -version`);
		return true;
	} catch {
		return false;
	}
}

async function showDownloadOptions() {
	const { option } = await inquirer.prompt([
		{
			type: 'list',
			name: 'option',
			message: '=== OPCIONES DE DESCARGA ===',
			choices: [
				{ name: '1. Video (calidad automática - recomendado)', value: '1' },
				{ name: '2. Solo audio (MP3)', value: '2' },
				{ name: '3. Video 1080p (si está disponible)', value: '3' },
				{ name: '4. Video 720p', value: '4' },
				{ name: '5. Personalizado (avanzado)', value: '5' },
			],
		},
	]);
	return option;
}

async function getDownloadArguments(option) {
    let baseArgs = ['--console-title', '--no-part'];
	if (ffmpegAvailable) {
		baseArgs.push('--ffmpeg-location', ffmpegBinDir);
	}

	switch (option) {
		case '1':
			baseArgs.push('-f', 'best[height<=720]/best');
			if (ffmpegAvailable)
				baseArgs.push('--embed-metadata', '--embed-thumbnail');
			break;
		case '2':
			baseArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
			if (ffmpegAvailable) baseArgs.push('--embed-metadata');
			break;
		case '3':
			baseArgs.push(
				'-f',
				'bestvideo[height<=1080]+bestaudio/best[height<=1080]'
			);
			if (ffmpegAvailable)
				baseArgs.push('--embed-metadata', '--embed-thumbnail');
			break;
		case '4':
			baseArgs.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]');
			if (ffmpegAvailable)
				baseArgs.push('--embed-metadata', '--embed-thumbnail');
			break;
		case '5':
			const { customFormat } = await inquirer.prompt([
				{
					type: 'input',
					name: 'customFormat',
					message: 'Formato personalizado (ej: bestvideo+bestaudio):',
				},
			]);
			if (customFormat) baseArgs.push('-f', customFormat);
			if (
				ffmpegAvailable &&
				(await getUserConfirmation('¿Incluir metadatos y miniaturas?'))
			) {
				baseArgs.push('--embed-metadata', '--embed-thumbnail');
			}
			break;
	}
	return baseArgs;
}

async function testValidUrl(url) {
	if (!url || url.trim() === '') return false;
	const patterns = [
		/^https?:\/\//,
		/youtube\.com|youtu\.be/,
		/vimeo\.com/,
		/twitter\.com/,
		/tiktok\.com/,
		/instagram\.com/,
		/facebook\.com/,
		/twitch\.tv/,
	];
	if (patterns.some(p => p.test(url))) return true;

	writeColor(
		'ADVERTENCIA: La URL no parece ser de un sitio conocido',
		'yellow'
	);
	return await getUserConfirmation('¿Continuar de todos modos?');
}

// --- Función Principal ---

async function startDownloader() {
    console.clear();
    writeColor("=== INICIALIZANDO DESCARGADOR DE VIDEOS v2.0 ===", 'cyan');

    if (!await testInternetConnection()) {
        writeColor("ADVERTENCIA: No hay conexión a internet o es inestable", 'yellow');
        if (!await getUserConfirmation("¿Continuar de todos modos?")) process.exit(1);
    }

    if (!fs.existsSync(ytdlpPath)) {
        writeColor("Descargando yt-dlp...", 'yellow');
        if (!await safeDownload(ytdlpUrl, ytdlpPath)) {
            writeColor("ERROR: No se pudo descargar yt-dlp. Verifica tu conexión.", 'red');
            process.exit(1);
        }
        writeColor("yt-dlp descargado correctamente", 'green');
    } else {
        await updateYtdlp();
    }

    if (fs.existsSync(ffmpegExePath)) {
        const missingFiles = testFFmpegComplete();
        if (missingFiles.length === 0) {
            writeColor("FFmpeg detectado y completo", 'green');
            ffmpegAvailable = true;
        } else {
            writeColor(`FFmpeg incompleto - faltan: ${missingFiles.join(', ')}`, 'yellow');
            if (await getUserConfirmation("¿Deseas reparar la instalación de FFmpeg?")) {
                ffmpegAvailable = await installFFmpeg();
            }
        }
    } else {
        if (await getUserConfirmation("¿Deseas descargar FFmpeg para mejores funciones (recomendado)?")) {
            ffmpegAvailable = await installFFmpeg();
            if (!ffmpegAvailable) writeColor("AVISO: FFmpeg no se pudo instalar, pero puedes continuar.", 'yellow');
        } else {
            writeColor("Continuando sin FFmpeg - algunas funciones estarán limitadas", 'yellow');
        }
    }

    if (ffmpegAvailable) {
        process.env.PATH = `${ffmpegBinDir}${path.delimiter}${process.env.PATH}`;
        writeColor("FFmpeg agregado al PATH de esta sesión", 'green');
    }

    const ffmpegFunctional = await testFFmpegFunctional();

    let keepDownloading = true;
    while (keepDownloading) {
        console.clear();
        writeColor("=== DESCARGADOR DE VIDEOS v2.0 ===", 'cyan');
        console.log(`  • yt-dlp: ${fs.existsSync(ytdlpPath) ? '✓' : '✗'}`);
        console.log(`  • FFmpeg: ${ffmpegFunctional ? '✓ Funcional' : ffmpegAvailable ? '⚠ Parcial' : '✗ No disponible'}`);
        console.log("");

        let url;
        while (!url) {
            const answer = await inquirer.prompt([{ type: 'input', name: 'url', message: 'Introduce la URL del video/playlist:' }]);
            if (await testValidUrl(answer.url)) {
                url = answer.url;
            } else {
                writeColor("URL no válida o no reconocida", 'red');
            }
        }

        const option = await showDownloadOptions();

        const history = readHistory();
        const choices = [
            ...history.map(p => ({ name: p, value: p })),
            new inquirer.Separator(),
            { name: 'Escribir una nueva ruta', value: 'new' },
            { name: 'Usar carpeta actual', value: 'current' }
        ];

        const { selectedPath } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedPath',
            message: 'Selecciona una carpeta de descarga:',
            choices: choices,
            loop: false
        }]);

        let downloadFolder;
        if (selectedPath === 'new') {
            const { newFolder } = await inquirer.prompt([{
                type: 'input',
                name: 'newFolder',
                message: 'Introduce la nueva ruta de descarga:',
                validate: input => input.trim() !== '' || 'La ruta no puede estar vacía.'
            }]);
            const trimmedPath = newFolder.trim();
            downloadFolder = path.resolve(trimmedPath);
            addToHistory(downloadFolder);
        } else if (selectedPath === 'current') {
            downloadFolder = process.cwd();
        } else {
            downloadFolder = selectedPath;
            addToHistory(downloadFolder); // Move selected path to top
        }

        if (!fs.existsSync(downloadFolder)) {
            writeColor("La carpeta no existe. Creando...", 'yellow');
            try {
                fs.mkdirSync(downloadFolder, { recursive: true });
                writeColor("Carpeta creada exitosamente", 'green');
            } catch (error) {
                writeColor(`ERROR: No se pudo crear la carpeta: ${error.message}`, 'red');
                continue;
            }
        }

        console.log("");
        writeColor("=== RESUMEN ===", 'cyan');
        writeColor(`URL: ${url}`, 'yellow');
        writeColor(`Carpeta: ${downloadFolder}`, 'yellow');
        console.log("");

        if (await getUserConfirmation("¿Iniciar la descarga?")) {
            try {
                const args = await getDownloadArguments(option);
                args.push(url);

                writeColor(`Comando: ${ytdlpPath} ${args.join(' ')}`, 'gray');
                console.log("");

                const downloadProcess = spawn(ytdlpPath, args, { cwd: downloadFolder, stdio: 'inherit' });

                await new Promise((resolve, reject) => {
                    downloadProcess.on('close', (code) => {
                        if (code === 0) {
                            console.log("");
                            writeColor(">>> DESCARGA COMPLETADA EXITOSAMENTE! <<<", 'green');
                            writeColor(`Archivos guardados en: ${downloadFolder}`, 'green');
                            resolve();
                        } else {
                            console.log("");
                            writeColor(`ERROR en la descarga. Código: ${code}`, 'red');
                            reject(new Error(`Exit code: ${code}`));
                        }
                    });
                    downloadProcess.on('error', (err) => {
                        writeColor(`ERROR al ejecutar yt-dlp: ${err.message}`, 'red');
                        reject(err);
                    });
                });

            } catch (error) {
                // El error ya se muestra en el listener del proceso
            }
        } else {
            writeColor("Descarga cancelada.", 'yellow');
        }

        console.log("");
        keepDownloading = await getUserConfirmation("¿Deseas hacer otra descarga?");
    }

    console.log("");
    writeColor("¡Gracias por usar el descargador!", 'cyan');
}

// Iniciar el programa
if (!fs.existsSync(ytdlpPath)) {
	startDownloader().catch(err => {
		console.error(err);
		process.exit(1);
	});
} else {
	startDownloader().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
