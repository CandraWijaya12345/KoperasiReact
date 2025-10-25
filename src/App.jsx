import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

// 1. [PERBAIKAN] Mengubah nama import agar sesuai dengan screenshot Anda
import KoperasiABI from './abi/koperasisimpanpinjambaru.json';
import IDRTokenABI from './abi/idrtokenbaru.json';

// --- KONFIGURASI ---
// Alamat Anda sudah benar
const KOPERASI_CONTRACT_ADDRESS = "0xdF8666E39a80819D7447c5B8500b10e94bf04814";
const IDRTOKEN_CONTRACT_ADDRESS = "0x1E36fc90247F963c297570F5554103459e060426";

// Helper untuk format token (Ethers v6)
const formatToken = (jumlah) => {
    if (!jumlah) return "0";
    // [PERBAIKAN v6] 'ethers.utils.formatUnits' -> 'ethers.formatUnits'
    return ethers.formatUnits(jumlah, 18); 
};

// Helper untuk parse token (Ethers v6)
const parseToken = (jumlah) => {
    if (!jumlah) jumlah = "0";
    // [PERBAIKAN v6] 'ethers.utils.parseUnits' -> 'ethers.parseUnits'
    return ethers.parseUnits(jumlah, 18);
};

function App() {
    // State Koneksi Ethers
    // const [provider, setProvider] = useState(null);
    // const [signer, setSigner] = useState(null);
    const [userAccount, setUserAccount] = useState(null);
    const [koperasiContract, setKoperasiContract] = useState(null);
    const [idrTokenContract, setIdrTokenContract] = useState(null);

    // State Data Aplikasi
    const [message, setMessage] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isPengurus, setIsPengurus] = useState(false);
    
    // Data Pengguna
    const [idrtBalance, setIdrtBalance] = useState("0");
    const [anggotaData, setAnggotaData] = useState(null);
    const [totalSimpanan, setTotalSimpanan] = useState("0");
    const [pinjamanAktif, setPinjamanAktif] = useState(null);
    const [history, setHistory] = useState([]);

    // State untuk Form
    const [namaDaftar, setNamaDaftar] = useState("");
    const [jumlahSukarela, setJumlahSukarela] = useState("");
    const [jumlahPinjaman, setJumlahPinjaman] = useState("");
    const [jumlahAngsuran, setJumlahAngsuran] = useState("");
    const [idPinjamanAdmin, setIdPinjamanAdmin] = useState("");
    
    // --- 1. KONEKSI DAN INISIALISASI ---

    const connectWallet = async () => {
        if (window.ethereum) {
            try {
                setIsLoading(true);
                setMessage("Menghubungkan ke MetaMask...");
                
                // [PERBAIKAN v6] 'ethers.providers.Web3Provider' -> 'ethers.BrowserProvider'
                const provider = new ethers.BrowserProvider(window.ethereum);
                
                // [PERBAIKAN v6] 'provider.getSigner()' -> 'await provider.getSigner()'
                const signer = await provider.getSigner();
                const account = await signer.getAddress();
                
                // Inisialisasi Kontrak Koperasi
                const kopContract = new ethers.Contract(
                    KOPERASI_CONTRACT_ADDRESS,
                    KoperasiABI.abi, // Ambil 'abi' dari JSON yang sudah diformat
                    signer
                );
                
                // Inisialisasi Kontrak Token
                const tokenContract = new ethers.Contract(
                    IDRTOKEN_CONTRACT_ADDRESS,
                    IDRTokenABI.abi, // Ambil 'abi' dari JSON yang sudah diformat
                    signer
                );

                // setProvider(provider);
                // setSigner(signer);
                setUserAccount(account);
                setKoperasiContract(kopContract);
                setIdrTokenContract(tokenContract);
                
                setMessage(`Terhubung: ${account.substring(0, 6)}...${account.substring(account.length - 4)}`);
                await fetchUserData(account, kopContract, tokenContract);
                
            } catch (err) {
                console.error(err);
                setMessage("Gagal terhubung. " + (err.data?.message || err.message));
            } finally {
                setIsLoading(false);
            }
        } else {
            setMessage("Harap install MetaMask!");
        }
    };
    
    // Cek koneksi saat halaman dimuat
    useEffect(() => {
        const checkConnection = async () => {
             if (window.ethereum) {
                try {
                    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                    if (accounts.length > 0) {
                        await connectWallet();
                    }
                } catch (err) {
                    console.error("Gagal auto-connect:", err);
                }
             }
        };
        checkConnection();
    }, []); // <-- Hanya berjalan sekali saat muat

    // --- 2. FUNGSI READ (Ambil Data dari Blockchain) ---
    
    // [PERBAIKAN] Bungkus 'fetchHistory' di dalam useCallback agar dependensi 'fetchUserData' valid
    const fetchHistory = useCallback(async (account, kopContract) => {
        setMessage("Mengambil riwayat transaksi (mungkin perlu waktu)...");
        try {
            // Filter untuk event yang 'dari' pengguna
            const filterSimpanan = kopContract.filters.SimpananMasuk(account);
            const filterTarik = kopContract.filters.PenarikanSukses(account);
            
            // Filter untuk event yang 'untuk' pengguna (peminjam)
            const filterAjukan = kopContract.filters.PinjamanDiajukan(null, account);
            const filterDisetujui = kopContract.filters.PinjamanDisetujui(null, account);
            const filterBayar = kopContract.filters.AngsuranDibayar(null, account, null);
            const filterLunas = kopContract.filters.PinjamanLunas(null, account);
            
            const [logSimpanan, logTarik, logAjukan, logDisetujui, logBayar, logLunas] = await Promise.all([
                kopContract.queryFilter(filterSimpanan, 0, 'latest'),
                kopContract.queryFilter(filterTarik, 0, 'latest'),
                kopContract.queryFilter(filterAjukan, 0, 'latest'),
                kopContract.queryFilter(filterDisetujui, 0, 'latest'),
                kopContract.queryFilter(filterBayar, 0, 'latest'),
                kopContract.queryFilter(filterLunas, 0, 'latest'),
            ]);

            const allLogs = [...logSimpanan, ...logTarik, ...logAjukan, ...logDisetujui, ...logBayar, ...logLunas];
            
            // Urutkan berdasarkan waktu (timestamp)
            // [PERBAIKAN v6] Gunakan Number() untuk konversi BigInt ke number
            allLogs.sort((a, b) => Number(b.args.waktu) - Number(a.args.waktu));
            
            setHistory(allLogs);
            
        } catch (err) {
            console.error("Gagal ambil history:", err);
            setMessage("Gagal mengambil riwayat.");
        }
    }, []);

    const fetchUserData = useCallback(async (account, kopContract, tokenContract) => {
        if (!account || !kopContract || !tokenContract) return;

        try {
            setMessage("Mengambil data pengguna...");
            // 1. Ambil Saldo IDRT
            const balance = await tokenContract.balanceOf(account);
            setIdrtBalance(formatToken(balance));

            // 2. Cek Status Pengurus
            const pengurus = await kopContract.isPengurus(account);
            setIsPengurus(pengurus);

            // 3. Ambil Data Anggota
            const data = await kopContract.dataAnggota(account);
            setAnggotaData(data);

            if (data.terdaftar) {
                // 4. Ambil Total Simpanan
                const simpanan = await kopContract.getTotalSimpananAnggota(account);
                setTotalSimpanan(formatToken(simpanan));

                // 5. Cek Pinjaman Aktif
                const idPinjamanAktif = await kopContract.idPinjamanAktifAnggota(account);
                // [PERBAIKAN v6] Gunakan Number() untuk konversi BigInt
                if (Number(idPinjamanAktif) > 0) {
                    const pinjaman = await kopContract.dataPinjaman(idPinjamanAktif);
                    setPinjamanAktif(pinjaman);
                } else {
                    setPinjamanAktif(null);
                }
                
                // 6. Ambil Riwayat Transaksi
                await fetchHistory(account, kopContract);
            }
            setMessage("Data berhasil dimuat.");
        } catch (err) {
            console.error(err);
            setMessage("Gagal mengambil data: " + (err.data?.message || err.message));
        }
    }, [fetchHistory]); // Hapus dependensi yang tidak perlu, fetchHistory sudah di-memoize
    
    // --- 3. FUNGSI HISTORY (Ambil dari Events) ---
    // (Sudah dipindah ke atas agar bisa dipakai di fetchUserData)
    

    // --- 4. FUNGSI WRITE (Transaksi) ---
    
    const handleApprove = async (amount) => {
        if (!idrTokenContract || !userAccount) return false;
        
        try {
            setMessage(`Meminta approval untuk ${formatToken(amount)} IDRT...`);
            const allowance = await idrTokenContract.allowance(userAccount, KOPERASI_CONTRACT_ADDRESS);
            // [PERBAIKAN v6] Gunakan 'lt' (less than) untuk membandingkan BigInt
            if (allowance < amount) {
                 // Jika allowance kurang, minta approve
                const tx = await idrTokenContract.approve(KOPERASI_CONTRACT_ADDRESS, amount);
                await tx.wait();
                setMessage("Approval sukses! Silakan lanjutkan transaksi.");
            } else {
                setMessage("Approval sudah ada. Siap transaksi.");
            }
            return true;
        } catch (err) {
            console.error(err);
            setMessage("Gagal approval: " + (err.data?.message || err.message));
            return false;
        }
    };
    
    const handleMint = async () => {
        if (!idrTokenContract || !userAccount) {
            setMessage("Hubungkan wallet dulu.");
            return;
        }
        setIsLoading(true);
        setMessage("Mencetak 1,000,000 IDRT untuk testing...");
        try {
            const amount = parseToken("1000000");
            const tx = await idrTokenContract.mint(userAccount, amount);
            await tx.wait();
            setMessage("Minting sukses!");
            await fetchUserData(userAccount, koperasiContract, idrTokenContract);
        } catch (err) {
            console.error(err);
            setMessage("Minting Gagal: " + (err.data?.message || err.message));
        }
        setIsLoading(false);
    };

    const handleDaftar = async () => {
        if (!namaDaftar) {
            setMessage("Nama tidak boleh kosong.");
            return;
        }
        setIsLoading(true);
        try {
            const biayaPokok = await koperasiContract.SIMPANAN_POKOK();
            const approved = await handleApprove(biayaPokok);
            if (!approved) {
                setIsLoading(false);
                return;
            }
            
            setMessage("Memproses pendaftaran di blockchain...");
            const tx = await koperasiContract.daftarAnggota(namaDaftar);
            await tx.wait();
            
            setMessage("Selamat! Anda berhasil terdaftar.");
            setNamaDaftar("");
            await fetchUserData(userAccount, koperasiContract, idrTokenContract);
            
        } catch (err) {
            console.error(err);
            setMessage("Pendaftaran Gagal: " + (err.data?.message || err.message));
        }
        setIsLoading(false);
    };
    
    const handleSetorSukarela = async () => {
        setIsLoading(true);
        try {
            const jumlah = parseToken(jumlahSukarela);
            const approved = await handleApprove(jumlah);
            if (!approved) {
                setIsLoading(false);
                return;
            }
            
            setMessage("Memproses setoran...");
            const tx = await koperasiContract.setorSimpananSukarela(jumlah);
            await tx.wait();
            
            setMessage("Setoran sukses!");
            setJumlahSukarela("");
            await fetchUserData(userAccount, koperasiContract, idrTokenContract);
            
        } catch (err) {
            console.error(err);
            setMessage("Setoran Gagal: " + (err.data?.message || err.message));
        }
        setIsLoading(false);
    };

    const handleAjukanPinjaman = async () => {
        setIsLoading(true);
        try {
            const jumlah = parseToken(jumlahPinjaman);
            setMessage("Mengajukan pinjaman...");
            const tx = await koperasiContract.ajukanPinjaman(jumlah);
            await tx.wait();
            
            setMessage("Pinjaman berhasil diajukan, menunggu persetujuan pengurus.");
            setJumlahPinjaman("");
            await fetchUserData(userAccount, koperasiContract, idrTokenContract);
            
        } catch (err) {
            console.error(err);
            setMessage("Pengajuan Gagal: " + (err.data?.message || err.message));
        }
        setIsLoading(false);
    };

    const handleBayarAngsuran = async () => {
        setIsLoading(true);
        try {
            const jumlah = parseToken(jumlahAngsuran);
            const approved = await handleApprove(jumlah);
            if (!approved) {
                setIsLoading(false);
                return;
            }
            
            setMessage("Memproses pembayaran angsuran...");
            // [PERBAIKAN v6] Gunakan Number() untuk ID pinjaman
            const tx = await koperasiContract.bayarAngsuran(Number(pinjamanAktif.id), jumlah);
            await tx.wait();
            
            setMessage("Pembayaran angsuran sukses!");
            setJumlahAngsuran("");
            await fetchUserData(userAccount, koperasiContract, idrTokenContract);
            
        } catch (err) {
            console.error(err);
            setMessage("Pembayaran Gagal: " + (err.data?.message || err.message));
        }
        setIsLoading(false);
    };
    
    // --- 5. FUNGSI ADMIN ---
    
    const handleSetujuiPinjaman = async () => {
        setIsLoading(true);
        try {
            setMessage(`Menyetujui pinjaman ID: ${idPinjamanAdmin}...`);
            const tx = await koperasiContract.setujuiPinjaman(idPinjamanAdmin);
            await tx.wait();
            setMessage(`Pinjaman ID ${idPinjamanAdmin} berhasil disetujui.`);
            setIdPinjamanAdmin("");
            await fetchUserData(userAccount, koperasiContract, idrTokenContract);
        } catch (err) {
            console.error(err);
            setMessage("Gagal Setujui: " + (err.data?.message || err.message));
        }
        setIsLoading(false);
    };

    // --- 6. RENDER UI ---
    
    const renderHistoryItem = (log) => {
        const { args, event, transactionHash } = log;
        const shortHash = transactionHash.substring(0, 6) + "..." + transactionHash.substring(transactionHash.length - 4);
        // [PERBAIKAN v6] Gunakan Number() untuk konversi BigInt
        const waktu = new Date(Number(args.waktu) * 1000).toLocaleString('id-ID');
        
        switch(event) {
            case 'SimpananMasuk':
                return `[${waktu}] ${args.jenisSimpanan}: +${formatToken(args.jumlah)} IDRT (Tx: ${shortHash})`;
            case 'PenarikanSukses':
                return `[${waktu}] Tarik Sukarela: -${formatToken(args.jumlah)} IDRT (Tx: ${shortHash})`;
            case 'PinjamanDiajukan':
                return `[${waktu}] Pinjaman Diajukan: ${formatToken(args.jumlah)} IDRT (ID: ${Number(args.idPinjaman)})`;
            case 'PinjamanDisetujui':
                return `[${waktu}] Pinjaman Disetujui (ID: ${Number(args.idPinjaman)})`;
            case 'AngsuranDibayar':
                return `[${waktu}] Bayar Angsuran: ${formatToken(args.jumlah)} IDRT (ID: ${Number(args.idPinjaman)})`;
            case 'PinjamanLunas':
                return `[${waktu}] Pinjaman Lunas (ID: ${Number(args.idPinjaman)})`;
            default:
                return `[${waktu}] Event: ${event}`;
        }
    };

    return (
        <div style={styles.container}>
            <h1 style={styles.title}>Koperasi Simpan Pinjam (ERC20 Full On-Chain)</h1>
            {message && <p style={styles.message}>{message}</p>}
            
            {!userAccount ? (
                <button style={styles.button} onClick={connectWallet} disabled={isLoading}>
                    {isLoading ? "Menghubungkan..." : "Hubungkan MetaMask"}
                </button>
            ) : (
                <div style={styles.card}>
                    <h3>Dasbor Pengguna</h3>
                    <p><strong>Alamat:</strong> {userAccount}</p>
                    <p><strong>Status:</strong> {anggotaData && anggotaData.terdaftar ? `Anggota (${anggotaData.nama})` : 'Bukan Anggota'}</p>
                    <p><strong>Saldo IDRT Anda:</strong> {idrtBalance} IDRT</p>
                    {anggotaData && anggotaData.terdaftar && (
                         <p><strong>Total Simpanan Koperasi:</strong> {totalSimpanan} IDRT</p>
                    )}
                </div>
            )}
            
            {/* Tombol Mint (Testing) */}
            {userAccount && (
                <div style={styles.card}>
                    <h4>Testing: Mint IDRT</h4>
                    <p>Gunakan ini untuk mendapatkan token IDRT gratis di testnet jika Anda adalah 'Owner' dari kontrak IDRT.</p>
                    <button style={styles.buttonAlt} onClick={handleMint} disabled={isLoading}>
                        {isLoading ? "Memproses..." : "Mint 1,000,000 IDRT"}
                    </button>
                </div>
            )}

            {/* Panel Pendaftaran */}
            {userAccount && !isLoading && anggotaData && !anggotaData.terdaftar && (
                <div style={styles.card}>
                    <h4>Pendaftaran Anggota</h4>
                    <p>Biaya: {formatToken(parseToken("100000"))} IDRT (Simpanan Pokok)</p>
                    <input 
                        style={styles.input}
                        value={namaDaftar}
                        onChange={(e) => setNamaDaftar(e.target.value)}
                        placeholder="Masukkan Nama Anda"
                    />
                    <button style={styles.button} onClick={handleDaftar} disabled={isLoading}>
                        {isLoading ? "Memproses..." : "1. Approve & 2. Daftar"}
                    </button>
                </div>
            )}
            
            {/* Panel Anggota */}
            {userAccount && !isLoading && anggotaData && anggotaData.terdaftar && (
                <>
                    {/* Panel Setoran */}
                    <div style={styles.card}>
                        <h4>Setor Simpanan Sukarela</h4>
                        <input 
                            style={styles.input}
                            type="number"
                            value={jumlahSukarela}
                            onChange={(e) => setJumlahSukarela(e.target.value)}
                            placeholder="Jumlah IDRT"
                        />
                        <button style={styles.button} onClick={handleSetorSukarela} disabled={isLoading || !jumlahSukarela}>
                            {isLoading ? "Memproses..." : "1. Approve & 2. Setor"}
                        </button>
                    </div>
                    
                    {/* Panel Pinjaman */}
                    <div style={styles.card}>
                        <h4>Manajemen Pinjaman</h4>
                        {!pinjamanAktif ? (
                            <>
                                <p>Anda tidak memiliki pinjaman aktif.</p>
                                <input 
                                    style={styles.input}
                                    type="number"
                                    value={jumlahPinjaman}
                                    onChange={(e) => setJumlahPinjaman(e.target.value)}
                                    placeholder="Jumlah pinjaman IDRT"
                                />
                                <button style={styles.button} onClick={handleAjukanPinjaman} disabled={isLoading || !jumlahPinjaman}>
                                    {isLoading ? "Memproses..." : "Ajukan Pinjaman"}
                                </button>
                            </>
                        ) : (
                            <>
                                <p><strong>ID Pinjaman Aktif:</strong> {Number(pinjamanAktif.id)}</p>
                                <p><strong>Total Utang:</strong> {formatToken(pinjamanAktif.jumlahHarusDikembalikan)} IDRT</p>
                                <p><strong>Sudah Dibayar:</strong> {formatToken(pinjamanAktif.sudahDibayar)} IDRT</p>
                                <p><strong>Sisa Utang:</strong> {formatToken(pinjamanAktif.jumlahHarusDikembalikan - pinjamanAktif.sudahDibayar)} IDRT</p>
                                <hr style={{margin: '15px 0'}}/>
                                <input 
                                    style={styles.input}
                                    type="number"
                                    value={jumlahAngsuran}
                                    onChange={(e) => setJumlahAngsuran(e.target.value)}
                                    placeholder="Jumlah angsuran IDRT"
                                />
                                <button style={styles.button} onClick={handleBayarAngsuran} disabled={isLoading || !jumlahAngsuran}>
                                    {isLoading ? "Memproses..." : "1. Approve & 2. Bayar Angsuran"}
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}

            {/* Panel Admin */}
            {userAccount && isPengurus && (
                <div style={{...styles.card, backgroundColor: '#fffbe6'}}>
                    <h4>Panel Admin</h4>
                    <input 
                        style={styles.input}
                        type="number"
                        value={idPinjamanAdmin}
                        onChange={(e) => setIdPinjamanAdmin(e.target.value)}
                        placeholder="ID Pinjaman yang disetujui"
                    />
                    <button style={styles.buttonAlt} onClick={handleSetujuiPinjaman} disabled={isLoading || !idPinjamanAdmin}>
                        {isLoading ? "Memproses..." : "Setujui Pinjaman"}
                    </button>
                </div>
            )}
            
            {/* Panel Riwayat */}
            {userAccount && anggotaData && anggotaData.terdaftar && (
                 <div style={styles.card}>
                    <h4>Riwayat Transaksi (dari Events)</h4>
                    <button style={styles.buttonAlt} onClick={() => fetchUserData(userAccount, koperasiContract, idrTokenContract)} disabled={isLoading}>
                        {isLoading ? "Memuat..." : "Refresh Riwayat"}
                    </button>
                    <ul style={styles.historyList}>
                        {history.length > 0 ? history.map((log, index) => (
                            <li key={index}>{renderHistoryItem(log)}</li>
                        )) : (
                            <li>Tidak ada riwayat.</li>
                        )}
                    </ul>
                 </div>
            )}
            
        </div>
    );
}

// --- CSS STYLING ---
const styles = {
    container: { fontFamily: 'Arial, sans-serif', maxWidth: '700px', margin: '20px auto', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' },
    title: { textAlign: 'center', color: '#333' },
    message: { textAlign: 'center', padding: '12px', margin: '10px 0', backgroundColor: '#ecf0f1', borderRadius: '5px', color: '#2c3e50', border: '1px solid #bdc3c7', wordWrap: 'break-word' },
    card: { backgroundColor: '#ffffff', border: '1px solid #ddd', borderRadius: '8px', padding: '20px', margin: '20px 0', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' },
    input: { boxSizing: 'border-box', width: '100%', padding: '10px', margin: '10px 0', border: '1px solid #ccc', borderRadius: '4px', fontSize: '16px' },
    button: { backgroundColor: '#3498db', color: 'white', border: 'none', padding: '12px 20px', borderRadius: '5px', cursor: 'pointer', fontSize: '16px', width: '100%', transition: 'background-color 0.3s' },
    buttonAlt: { backgroundColor: '#f39c12', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '5px', cursor: 'pointer', fontSize: '14px', marginBottom: '10px', transition: 'background-color 0.3s' },
    historyList: { listStyleType: 'none', padding: '10px', maxHeight: '300px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '5px', marginTop: '10px', fontSize: '14px', lineHeight: '1.6' }
};

export default App;

