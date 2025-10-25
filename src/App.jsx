import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

// 1. Nama import sesuai screenshot Anda
import KoperasiABI from './abi/koperasisimpanpinjambaru.json';
import IDRTokenABI from './abi/idrtokenbaru.json';

// --- KONFIGURASI ---
// Alamat Anda sudah benar
const KOPERASI_CONTRACT_ADDRESS = "0xdF8666E39a80819D7447c5B8500b10e94bf04814";
const IDRTOKEN_CONTRACT_ADDRESS = "0x1E36fc90247F963c297570F5554103459e060426";

// Helper untuk format token (Ethers v6)
const formatToken = (jumlah) => {
    if (jumlah === undefined || jumlah === null) return "0";
    try {
        // Handle BigInt conversion safely
        return ethers.formatUnits(String(jumlah), 18);
    } catch (error) {
        console.error("Error formatting token:", jumlah, error);
        return "Invalid Amount";
    }
};

// Helper untuk parse token (Ethers v6)
const parseToken = (jumlah) => {
    if (!jumlah || jumlah === "") jumlah = "0";
    try {
        return ethers.parseUnits(jumlah, 18);
    } catch (error) {
        console.error("Error parsing token:", jumlah, error);
        return ethers.parseUnits("0", 18); // Return 0 if parsing fails
    }
};

// Helper format tanggal
const formatTimestamp = (timestamp) => {
     if (!timestamp) return 'N/A';
     const tsNumber = Number(timestamp);
     if (isNaN(tsNumber) || tsNumber === 0) return 'N/A';
     return new Date(tsNumber * 1000).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium'});
}

function App() {
    // State Koneksi Ethers
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

    // [PENAMBAHAN] State untuk daftar pinjaman pending (khusus admin)
    const [pendingLoans, setPendingLoans] = useState([]);
    const [loadingLoans, setLoadingLoans] = useState(false);


    // --- FUNGSI HISTORY (Ambil dari Events) ---
    const fetchHistory = useCallback(async (account, kopContract) => {
        if (!kopContract || !account) return;
        // Tidak perlu setMessage di sini, akan di-handle oleh fetchUserData
        try {
            const filterSimpanan = kopContract.filters.SimpananMasuk(account);
            const filterTarik = kopContract.filters.PenarikanSukses(account);
            const filterAnggotaBaru = kopContract.filters.AnggotaBaru(account);
            const filterAjukan = kopContract.filters.PinjamanDiajukan(null, account);
            const filterDisetujui = kopContract.filters.PinjamanDisetujui(null, account);
            const filterBayar = kopContract.filters.AngsuranDibayar(null, account, null);
            const filterLunas = kopContract.filters.PinjamanLunas(null, account);

            const [
                logSimpanan, logTarik, logAnggotaBaru, logAjukan,
                logDisetujui, logBayar, logLunas
            ] = await Promise.all([
                kopContract.queryFilter(filterSimpanan, 0, 'latest'),
                kopContract.queryFilter(filterTarik, 0, 'latest'),
                kopContract.queryFilter(filterAnggotaBaru, 0, 'latest'),
                kopContract.queryFilter(filterAjukan, 0, 'latest'),
                kopContract.queryFilter(filterDisetujui, 0, 'latest'),
                kopContract.queryFilter(filterBayar, 0, 'latest'),
                kopContract.queryFilter(filterLunas, 0, 'latest'),
            ]);

            const allLogs = [
                ...logSimpanan, ...logTarik, ...logAnggotaBaru, ...logAjukan,
                ...logDisetujui, ...logBayar, ...logLunas
            ];

            allLogs.sort((a, b) => {
                const timeA = a.args?.waktu ? Number(a.args.waktu) : 0;
                const timeB = b.args?.waktu ? Number(b.args.waktu) : 0;
                return timeB - timeA;
            });

            setHistory(allLogs);

        } catch (err) {
            console.error("Gagal ambil history:", err);
            setMessage((prev) => prev + " Gagal mengambil riwayat."); // Tambahkan pesan error
        }
    }, []);


    // --- [PENAMBAHAN] Fungsi untuk mengambil pinjaman pending (khusus Admin) ---
    const fetchPendingLoans = useCallback(async (kopContract) => {
         if (!kopContract) return;
         setLoadingLoans(true);
         setMessage("Mengambil daftar pinjaman pending...");
         try {
             // 1. Ambil semua event pengajuan
             const diajukanEvents = await kopContract.queryFilter(kopContract.filters.PinjamanDiajukan(), 0, 'latest');

             // 2. Ambil semua event persetujuan (untuk filtering)
             const disetujuiEvents = await kopContract.queryFilter(kopContract.filters.PinjamanDisetujui(), 0, 'latest');
             const approvedLoanIds = new Set(disetujuiEvents.map(log => Number(log.args.idPinjaman)));

             // 3. Ambil semua event lunas (untuk filtering, jaga-jaga)
             const lunasEvents = await kopContract.queryFilter(kopContract.filters.PinjamanLunas(), 0, 'latest');
             const paidLoanIds = new Set(lunasEvents.map(log => Number(log.args.idPinjaman)));

             // 4. Filter event pengajuan yang belum disetujui dan belum lunas
             const pendingEvents = diajukanEvents.filter(log => {
                 const loanId = Number(log.args.idPinjaman);
                 return !approvedLoanIds.has(loanId) && !paidLoanIds.has(loanId);
             });

             // 5. Ambil detail untuk setiap pinjaman pending
             const pendingLoansDetails = await Promise.all(
                 pendingEvents.map(async (log) => {
                     const loanId = Number(log.args.idPinjaman);
                     const peminjam = log.args.peminjam;
                     try {
                         // Ambil data pinjaman dari mapping
                         const pinjamanData = await kopContract.dataPinjaman(loanId);
                         // Ambil total simpanan peminjam
                         const totalSimpananPeminjam = await kopContract.getTotalSimpananAnggota(peminjam);

                         // Gabungkan data
                         return {
                             id: loanId,
                             peminjam: peminjam,
                             namaPeminjam: 'Memuat...', // Akan di-fetch terpisah jika perlu
                             jumlahPinjaman: pinjamanData.jumlahPinjaman,
                             waktuPengajuan: log.args.waktu,
                             totalSimpananSaatPengajuan: totalSimpananPeminjam, // Simpanan saat ini
                             status: 'Pending'
                         };
                     } catch (error) {
                          console.error(`Gagal mengambil detail pinjaman ID ${loanId}:`, error);
                          return null; // Abaikan jika gagal ambil detail
                     }
                 })
             );

              // Filter out null results from failed fetches
             const validPendingLoans = pendingLoansDetails.filter(loan => loan !== null);

             // Ambil nama peminjam (opsional, bisa menambah load)
             // for (let loan of validPendingLoans) {
             //     try {
             //         const anggotaInfo = await kopContract.dataAnggota(loan.peminjam);
             //         loan.namaPeminjam = anggotaInfo.nama || 'N/A';
             //     } catch {
             //         loan.namaPeminjam = 'Error';
             //     }
             // }


             setPendingLoans(validPendingLoans.sort((a,b) => Number(b.waktuPengajuan) - Number(a.waktuPengajuan))); // Urutkan terbaru dulu
             setMessage(validPendingLoans.length > 0 ? "Daftar pinjaman pending berhasil dimuat." : "Tidak ada pinjaman pending.");

         } catch (error) {
             console.error("Gagal mengambil pinjaman pending:", error);
             setMessage("Gagal mengambil daftar pinjaman pending.");
             setPendingLoans([]);
         } finally {
             setLoadingLoans(false);
         }
    }, []);


    // --- FUNGSI READ (Ambil Data dari Blockchain) ---
    const fetchUserData = useCallback(async (account, kopContract, tokenContract) => {
        if (!account || !kopContract || !tokenContract) return;

        setIsLoading(true); // Set loading di awal fetch
        setMessage("Mengambil data pengguna...");
        try {
            const balance = await tokenContract.balanceOf(account);
            setIdrtBalance(formatToken(balance));

            const pengurus = await kopContract.isPengurus(account);
            setIsPengurus(pengurus);

            const data = await kopContract.dataAnggota(account);
            setAnggotaData(data);

            if (data.terdaftar) {
                const simpanan = await kopContract.getTotalSimpananAnggota(account);
                setTotalSimpanan(formatToken(simpanan));

                const idPinjamanAktif = await kopContract.idPinjamanAktifAnggota(account);
                if (Number(idPinjamanAktif) > 0) {
                    const pinjaman = await kopContract.dataPinjaman(idPinjamanAktif);
                    // Pastikan pinjaman belum lunas sebelum di set sebagai aktif
                    if(pinjaman && !pinjaman.lunas) {
                        setPinjamanAktif(pinjaman);
                    } else {
                        setPinjamanAktif(null); // Set null jika sudah lunas
                    }
                } else {
                    setPinjamanAktif(null);
                }
                await fetchHistory(account, kopContract); // Panggil history di sini
            } else {
                 setHistory([]);
                 setPinjamanAktif(null);
                 setTotalSimpanan("0");
            }

            // [PENAMBAHAN] Jika pengguna adalah pengurus, ambil daftar pinjaman pending
            if (pengurus) {
                await fetchPendingLoans(kopContract);
            } else {
                setPendingLoans([]); // Kosongkan jika bukan pengurus
            }

            setMessage(data.terdaftar ? "Data pengguna & riwayat berhasil dimuat." : "Data pengguna berhasil dimuat (belum terdaftar).");

        } catch (err) {
            console.error("Error fetching user data:", err);
            setMessage("Gagal mengambil data pengguna: " + (err.data?.message || err.message));
             setIdrtBalance("0"); setAnggotaData(null); setIsPengurus(false);
             setTotalSimpanan("0"); setPinjamanAktif(null); setHistory([]);
             setPendingLoans([]); // Reset pending loans on error
        } finally {
             setIsLoading(false); // Set loading false di akhir, baik sukses maupun gagal
        }
    }, [fetchHistory, fetchPendingLoans]); // Tambahkan fetchPendingLoans


    // --- KONEKSI DAN INISIALISASI ---
    const connectWallet = useCallback(async () => {
        if (window.ethereum) {
            try {
                setIsLoading(true);
                setMessage("Menghubungkan ke MetaMask...");

                const provider = new ethers.BrowserProvider(window.ethereum);
                await provider.send("eth_requestAccounts", []);
                const signer = await provider.getSigner();
                const account = await signer.getAddress();

                const kopContract = new ethers.Contract(
                    KOPERASI_CONTRACT_ADDRESS, KoperasiABI.abi, signer
                );
                const tokenContract = new ethers.Contract(
                    IDRTOKEN_CONTRACT_ADDRESS, IDRTokenABI.abi, signer
                );

                setUserAccount(account);
                setKoperasiContract(kopContract); // Simpan instance dengan signer
                setIdrTokenContract(tokenContract); // Simpan instance dengan signer

                setMessage(`Terhubung: ${account.substring(0, 6)}...${account.substring(account.length - 4)}`);
                // Langsung panggil fetchUserData dengan instance yang sudah ada signer-nya
                await fetchUserData(account, kopContract, tokenContract);

            } catch (err) {
                console.error("Connection Error:", err);
                setMessage("Gagal terhubung. Pastikan Anda memilih akun di MetaMask. " + (err.data?.message || err.message || err.code));
                 setUserAccount(null); setKoperasiContract(null); setIdrTokenContract(null);
                 // Reset state lainnya
                 setIdrtBalance("0"); setAnggotaData(null); setIsPengurus(false);
                 setTotalSimpanan("0"); setPinjamanAktif(null); setHistory([]); setPendingLoans([]);
            } finally {
                setIsLoading(false);
            }
        } else {
            setMessage("Harap install MetaMask!");
        }
    }, [fetchUserData]);

    // Cek koneksi & handle account change
    useEffect(() => {
        const handleAccountsChanged = (accounts) => {
            if (accounts.length === 0) {
                console.log('User disconnected.');
                setUserAccount(null); setKoperasiContract(null); setIdrTokenContract(null);
                setMessage("Silakan hubungkan MetaMask Anda.");
                setIdrtBalance("0"); setAnggotaData(null); setIsPengurus(false);
                setTotalSimpanan("0"); setPinjamanAktif(null); setHistory([]); setPendingLoans([]);
            } else if (userAccount && accounts[0].toLowerCase() !== userAccount.toLowerCase()) { // Bandingkan case-insensitive
                console.log('Account changed:', accounts[0]);
                // Tidak perlu reconnect manual, cukup reset state & biarkan user klik connect lagi jika mau
                 setUserAccount(null); setKoperasiContract(null); setIdrTokenContract(null);
                 setMessage("Akun MetaMask berubah. Silakan hubungkan kembali.");
                 setIdrtBalance("0"); setAnggotaData(null); setIsPengurus(false);
                 setTotalSimpanan("0"); setPinjamanAktif(null); setHistory([]); setPendingLoans([]);
                // Atau panggil connectWallet() jika ingin auto-reconnect
                // connectWallet();
            }
        };

        if (window.ethereum) {
            window.ethereum.request({ method: 'eth_accounts' })
                .then(accounts => {
                    if (accounts.length > 0 && !userAccount) {
                        connectWallet();
                    }
                })
                .catch(err => console.error("Gagal auto-connect check:", err));

            window.ethereum.on('accountsChanged', handleAccountsChanged);
            return () => {
                if (window.ethereum.removeListener) {
                    window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
                }
            };
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userAccount]); // Hanya bergantung pada userAccount

    // Helper untuk mendapatkan signer saat dibutuhkan untuk transaksi write
    const getSigner = async () => {
         if (!window.ethereum) throw new Error("MetaMask tidak ditemukan");
         const provider = new ethers.BrowserProvider(window.ethereum);
         return await provider.getSigner();
    }


    // --- FUNGSI WRITE (Transaksi) ---
     const handleApprove = async (amount) => {
        if (!idrTokenContract || !userAccount) return false;
        try {
             const signer = await getSigner(); // Dapatkan signer baru
             const tokenContractWithSigner = idrTokenContract.connect(signer); // Hubungkan ke signer

            setMessage(`Meminta approval untuk ${formatToken(amount)} IDRT...`);
            const allowance = await tokenContractWithSigner.allowance(userAccount, KOPERASI_CONTRACT_ADDRESS);
            if (allowance < amount) {
                 const tx = await tokenContractWithSigner.approve(KOPERASI_CONTRACT_ADDRESS, amount);
                 setMessage("Menunggu konfirmasi approval...");
                await tx.wait();
                setMessage("Approval sukses! Silakan lanjutkan transaksi.");
            } else {
                setMessage("Approval sudah ada. Siap transaksi.");
            }
            return true;
        } catch (err) {
            console.error("Approval Error:", err);
             const reason = err.reason || err.data?.message || err.message || err.code;
            setMessage("Gagal approval: " + reason);
            return false;
        }
    };

    const handleMint = async () => {
        if (!idrTokenContract || !userAccount) { setMessage("Hubungkan wallet dulu."); return; }
        setIsLoading(true); setMessage("Mencetak 1,000,000 IDRT untuk testing...");
        try {
            const amount = parseToken("1000000");
             const signer = await getSigner();
            const tokenContractWithSigner = idrTokenContract.connect(signer);
            const tx = await tokenContractWithSigner.mint(userAccount, amount);
             setMessage("Menunggu konfirmasi minting..."); await tx.wait();
            setMessage("Minting sukses!");
            // Fetch ulang data setelah minting
            await fetchUserData(userAccount, koperasiContract.connect(signer), tokenContractWithSigner);
        } catch (err) {
            console.error("Minting Error:", err); const reason = err.reason || err.data?.message || err.message || err.code;
            setMessage("Minting Gagal: " + reason);
        } setIsLoading(false);
    };

    const handleDaftar = async () => {
        if (!namaDaftar) { setMessage("Nama tidak boleh kosong."); return; }
        if (!koperasiContract || !idrTokenContract || !userAccount) return;
        setIsLoading(true);
        try {
            // Ambil biaya pokok dari kontrak (lebih dinamis)
             const providerForRead = new ethers.BrowserProvider(window.ethereum); // Provider untuk read-only call
             const kopContractForRead = koperasiContract.connect(providerForRead);
             const biayaPokok = await kopContractForRead.SIMPANAN_POKOK();

            const approved = await handleApprove(biayaPokok);
            if (!approved) { setIsLoading(false); return; }
            setMessage("Memproses pendaftaran di blockchain...");
             const signer = await getSigner();
            const kopContractWithSigner = koperasiContract.connect(signer);
            const tx = await kopContractWithSigner.daftarAnggota(namaDaftar);
             setMessage("Menunggu konfirmasi pendaftaran..."); await tx.wait();
            setMessage("Selamat! Anda berhasil terdaftar."); setNamaDaftar("");
            await fetchUserData(userAccount, kopContractWithSigner, idrTokenContract.connect(signer));
        } catch (err) {
            console.error("Daftar Error:", err); const reason = err.reason || err.data?.message || err.message || err.code;
            setMessage("Pendaftaran Gagal: " + reason);
        } setIsLoading(false);
    };

     const handleSetorSukarela = async () => {
        if (!koperasiContract || !idrTokenContract || !userAccount) return;
        setIsLoading(true);
        try {
            const jumlah = parseToken(jumlahSukarela);
             if (jumlah <= 0n) { setMessage("Jumlah setoran harus lebih dari 0."); setIsLoading(false); return; }
            const approved = await handleApprove(jumlah);
            if (!approved) { setIsLoading(false); return; }
            setMessage("Memproses setoran...");
             const signer = await getSigner();
            const kopContractWithSigner = koperasiContract.connect(signer);
            const tx = await kopContractWithSigner.setorSimpananSukarela(jumlah);
             setMessage("Menunggu konfirmasi setoran..."); await tx.wait();
            setMessage("Setoran sukses!"); setJumlahSukarela("");
            await fetchUserData(userAccount, kopContractWithSigner, idrTokenContract.connect(signer));
        } catch (err) {
            console.error("Setor Sukarela Error:", err); const reason = err.reason || err.data?.message || err.message || err.code;
            setMessage("Setoran Gagal: " + reason);
        } setIsLoading(false);
    };

      const handleAjukanPinjaman = async () => {
        if (!koperasiContract || !userAccount) return;
        setIsLoading(true);
        try {
            const jumlah = parseToken(jumlahPinjaman);
             if (jumlah <= 0n) { setMessage("Jumlah pinjaman harus lebih dari 0."); setIsLoading(false); return; }
            setMessage("Mengajukan pinjaman...");
             const signer = await getSigner();
            const kopContractWithSigner = koperasiContract.connect(signer);
            const tx = await kopContractWithSigner.ajukanPinjaman(jumlah);
             setMessage("Menunggu konfirmasi pengajuan pinjaman..."); await tx.wait();
            setMessage("Pinjaman berhasil diajukan, menunggu persetujuan pengurus."); setJumlahPinjaman("");
             // Fetch ulang data pengguna untuk update riwayat event
            await fetchUserData(userAccount, kopContractWithSigner, idrTokenContract.connect(signer));
        } catch (err) {
            console.error("Ajukan Pinjaman Error:", err); const reason = err.reason || err.data?.message || err.message || err.code;
            setMessage("Pengajuan Gagal: " + reason);
        } setIsLoading(false);
    };

      const handleBayarAngsuran = async () => {
        if (!koperasiContract || !idrTokenContract || !userAccount || !pinjamanAktif) return;
        setIsLoading(true);
        try {
            const jumlah = parseToken(jumlahAngsuran);
             if (jumlah <= 0n) { setMessage("Jumlah angsuran harus lebih dari 0."); setIsLoading(false); return; }
            const approved = await handleApprove(jumlah);
            if (!approved) { setIsLoading(false); return; }
            setMessage("Memproses pembayaran angsuran...");
             const signer = await getSigner();
            const kopContractWithSigner = koperasiContract.connect(signer);
            const tx = await kopContractWithSigner.bayarAngsuran(Number(pinjamanAktif.id), jumlah);
             setMessage("Menunggu konfirmasi pembayaran..."); await tx.wait();
            setMessage("Pembayaran angsuran sukses!"); setJumlahAngsuran("");
            await fetchUserData(userAccount, kopContractWithSigner, idrTokenContract.connect(signer));
        } catch (err) {
            console.error("Bayar Angsuran Error:", err); const reason = err.reason || err.data?.message || err.message || err.code;
            setMessage("Pembayaran Gagal: " + reason);
        } setIsLoading(false);
    };

     const handleSetujuiPinjaman = async (loanId) => { // Terima ID sebagai argumen
        if (!koperasiContract || !userAccount || !loanId) return;
        setIsLoading(true);
        try {
            const idToApprove = parseInt(loanId, 10);
             if (isNaN(idToApprove) || idToApprove <= 0) { setMessage("ID Pinjaman tidak valid."); setIsLoading(false); return; }
            setMessage(`Menyetujui pinjaman ID: ${idToApprove}...`);
             const signer = await getSigner();
            const kopContractWithSigner = koperasiContract.connect(signer);
            const tx = await kopContractWithSigner.setujuiPinjaman(idToApprove);
             setMessage("Menunggu konfirmasi persetujuan..."); await tx.wait();
            setMessage(`Pinjaman ID ${idToApprove} berhasil disetujui.`);
            setIdPinjamanAdmin(""); // Kosongkan input field (jika masih dipakai)

            // Refresh data pengguna DAN daftar pinjaman pending
            await fetchUserData(userAccount, kopContractWithSigner, idrTokenContract.connect(signer));


        } catch (err) {
            console.error("Setujui Pinjaman Error:", err); const reason = err.reason || err.data?.message || err.message || err.code;
            setMessage("Gagal Setujui: " + reason);
        } setIsLoading(false);
    };


    // --- RENDER UI ---

    const renderHistoryItem = (log) => {
        const { args, transactionHash } = log;
        const eventName = log.eventName || log.event || log.fragment?.name;

        if (!args || typeof args !== 'object' || transactionHash === undefined) {
             console.error("Invalid log structure:", log); return `[Invalid Log]`;
        }
         const waktuNum = args.waktu ? Number(args.waktu) : null;
         if (waktuNum === null || isNaN(waktuNum)) {
             console.error("Invalid or missing timestamp in log args:", args);
             const shortHashFallback = transactionHash ? transactionHash.substring(0, 6) + "..." + transactionHash.substring(transactionHash.length - 4) : 'N/A';
             return `[Invalid Time] Event: ${eventName || 'Unknown'} (Tx: ${shortHashFallback})`;
         }

        const shortHash = transactionHash.substring(0, 6) + "..." + transactionHash.substring(transactionHash.length - 4);
        const waktu = formatTimestamp(waktuNum); // Gunakan helper

        switch(eventName) {
            case 'AnggotaBaru': {
                return `[${waktu}] Anggota Baru Terdaftar: ${args.nama || 'N/A'} (Tx: ${shortHash})`;
            }
            case 'SimpananMasuk': {
                const jenis = args.jenisSimpanan || 'Simpanan';
                 const jumlahSimpanan = args.jumlah !== undefined ? formatToken(args.jumlah) : 'N/A';
                return `[${waktu}] ${jenis}: +${jumlahSimpanan} IDRT (Tx: ${shortHash})`;
            }
            case 'PenarikanSukses': {
                 const jumlahTarik = args.jumlah !== undefined ? formatToken(args.jumlah) : 'N/A';
                return `[${waktu}] Tarik Sukarela: -${jumlahTarik} IDRT (Tx: ${shortHash})`;
            }
            case 'PinjamanDiajukan': {
                 const jumlahAjukan = args.jumlah !== undefined ? formatToken(args.jumlah) : 'N/A';
                 const idAjukan = args.idPinjaman !== undefined ? Number(args.idPinjaman) : 'N/A';
                return `[${waktu}] Pinjaman Diajukan: ${jumlahAjukan} IDRT (ID: ${idAjukan}) (Tx: ${shortHash})`; // Tambah Tx Hash
            }
            case 'PinjamanDisetujui': {
                 const idSetuju = args.idPinjaman !== undefined ? Number(args.idPinjaman) : 'N/A';
                return `[${waktu}] Pinjaman Disetujui (ID: ${idSetuju}) (Tx: ${shortHash})`;
            }
            case 'AngsuranDibayar': {
                 const jumlahBayar = args.jumlah !== undefined ? formatToken(args.jumlah) : 'N/A';
                 const idBayar = args.idPinjaman !== undefined ? Number(args.idPinjaman) : 'N/A';
                return `[${waktu}] Bayar Angsuran: ${jumlahBayar} IDRT (ID: ${idBayar}) (Tx: ${shortHash})`;
            }
            case 'PinjamanLunas': {
                  const idLunas = args.idPinjaman !== undefined ? Number(args.idPinjaman) : 'N/A';
                return `[${waktu}] Pinjaman Lunas (ID: ${idLunas}) (Tx: ${shortHash})`;
            }
            default: {
                return `[${waktu}] Event: ${eventName || 'Unknown Event'} (Tx: ${shortHash})`;
            }
        }
    };

    return (
        <div style={styles.container}>
            <h1 style={styles.title}>Koperasi Simpan Pinjam</h1>
            <p style={styles.message}>
                 {isLoading || loadingLoans ? <span style={{ fontStyle: 'italic' }}>Memproses...</span> : message || "Silakan hubungkan wallet Anda."}
            </p>

            {!userAccount && !isLoading && (
                <button style={styles.button} onClick={connectWallet}> Hubungkan MetaMask </button>
            )}

            {userAccount && (
                <div style={styles.card}>
                    <h3>Dasbor Pengguna</h3>
                    <p style={styles.address}><strong>Alamat:</strong> {userAccount}</p>
                    {anggotaData !== null ? (
                        <>
                            <p><strong>Status:</strong> {anggotaData.terdaftar ? `Anggota (${anggotaData.nama || 'Tanpa Nama'})` : 'Bukan Anggota'}</p>
                            <p><strong>Saldo IDRT Anda:</strong> {idrtBalance} IDRT</p>
                            {anggotaData.terdaftar && ( <p><strong>Total Simpanan Koperasi:</strong> {totalSimpanan} IDRT</p> )}
                        </>
                    ) : ( <p style={{fontStyle: 'italic'}}>Memuat data anggota...</p> )}
                </div>
            )}

            {userAccount && (
                <div style={styles.card}>
                    <h4>Testing: Mint IDRT</h4>
                    <p>Hanya Owner kontrak IDRT yang bisa melakukan ini.</p>
                    <button style={styles.buttonAlt} onClick={handleMint} disabled={isLoading}>
                        {isLoading ? "Memproses..." : "Mint 1,000,000 IDRT"}
                    </button>
                </div>
            )}

            {userAccount && !isLoading && anggotaData !== null && !anggotaData.terdaftar && (
                <div style={styles.card}>
                    <h4>Pendaftaran Anggota</h4>
                    <p>Biaya: {formatToken(parseToken("100000"))} IDRT (Simpanan Pokok)</p>
                    <input style={styles.input} value={namaDaftar} onChange={(e) => setNamaDaftar(e.target.value)} placeholder="Masukkan Nama Anda" disabled={isLoading} />
                    <button style={styles.button} onClick={handleDaftar} disabled={isLoading || !koperasiContract || !idrTokenContract}>
                        {isLoading ? "Memproses..." : "1. Approve & 2. Daftar"}
                    </button>
                </div>
            )}

            {userAccount && !isLoading && anggotaData !== null && anggotaData.terdaftar && (
                <>
                    <div style={styles.card}>
                        <h4>Setor Simpanan Sukarela</h4>
                        <input style={styles.input} type="number" value={jumlahSukarela} onChange={(e) => setJumlahSukarela(e.target.value)} placeholder="Jumlah IDRT" min="0" disabled={isLoading} />
                        <button style={styles.button} onClick={handleSetorSukarela} disabled={isLoading || !jumlahSukarela || parseFloat(jumlahSukarela) <= 0}>
                            {isLoading ? "Memproses..." : "1. Approve & 2. Setor"}
                        </button>
                    </div>

                    <div style={styles.card}>
                        <h4>Manajemen Pinjaman</h4>
                        {pinjamanAktif === null || pinjamanAktif.lunas ? ( // Tampilkan form ajukan jika tidak ada pinjaman aktif atau sudah lunas
                            <>
                                <p>Anda tidak memiliki pinjaman aktif.</p>
                                <input style={styles.input} type="number" value={jumlahPinjaman} onChange={(e) => setJumlahPinjaman(e.target.value)} placeholder="Jumlah pinjaman IDRT" min="0" disabled={isLoading} />
                                <button style={styles.button} onClick={handleAjukanPinjaman} disabled={isLoading || !jumlahPinjaman || parseFloat(jumlahPinjaman) <= 0}>
                                    {isLoading ? "Memproses..." : "Ajukan Pinjaman"}
                                </button>
                            </>
                        ) : ( // Tampilkan detail pinjaman dan form bayar jika ada pinjaman aktif & belum lunas
                            pinjamanAktif && ( // Extra check
                                <>
                                    <p><strong>ID Pinjaman Aktif:</strong> {Number(pinjamanAktif.id)}</p>
                                    <p><strong>Total Utang:</strong> {formatToken(pinjamanAktif.jumlahHarusDikembalikan)} IDRT</p>
                                    <p><strong>Sudah Dibayar:</strong> {formatToken(pinjamanAktif.sudahDibayar)} IDRT</p>
                                     <p><strong>Sisa Utang:</strong> {
                                         pinjamanAktif.jumlahHarusDikembalikan >= pinjamanAktif.sudahDibayar
                                         ? formatToken(pinjamanAktif.jumlahHarusDikembalikan - pinjamanAktif.sudahDibayar) : '0.0 (Lunas)'
                                     } IDRT</p>
                                    <hr style={{margin: '15px 0'}}/>
                                    <input style={styles.input} type="number" value={jumlahAngsuran} onChange={(e) => setJumlahAngsuran(e.target.value)} placeholder="Jumlah angsuran IDRT" min="0" disabled={isLoading} />
                                    <button style={styles.button} onClick={handleBayarAngsuran} disabled={isLoading || !jumlahAngsuran || parseFloat(jumlahAngsuran) <= 0}>
                                        {isLoading ? "Memproses..." : "1. Approve & 2. Bayar Angsuran"}
                                    </button>
                                </>
                            )
                        )}
                    </div>
                </>
            )}

            {/* [PENAMBAHAN] Panel Admin dengan Daftar Pinjaman Pending */}
            {userAccount && isPengurus && (
                <div style={{...styles.card, backgroundColor: '#fffbe6', borderColor: '#ffeeba'}}>
                    <h4>Panel Admin - Persetujuan Pinjaman</h4>
                    {loadingLoans ? (
                         <p>Memuat daftar pinjaman...</p>
                    ) : pendingLoans.length > 0 ? (
                        <div style={styles.tableContainer}>
                         <table style={styles.table}>
                            <thead>
                                <tr>
                                    <th style={styles.th}>ID</th>
                                    <th style={styles.th}>Peminjam</th>
                                    <th style={styles.th}>Jumlah Pinjam</th>
                                    <th style={styles.th}>Total Simpanan</th>
                                    <th style={styles.th}>Waktu Ajuan</th>
                                    <th style={styles.th}>Aksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pendingLoans.map((loan) => (
                                    <tr key={loan.id}>
                                        <td style={styles.td}>{loan.id}</td>
                                        <td style={{...styles.td, ...styles.addressSmall}} title={loan.peminjam}>
                                            {`${loan.peminjam.substring(0, 6)}...${loan.peminjam.substring(loan.peminjam.length - 4)}`}
                                        </td>
                                        <td style={styles.td}>{formatToken(loan.jumlahPinjaman)} IDRT</td>
                                        <td style={styles.td}>{formatToken(loan.totalSimpananSaatPengajuan)} IDRT</td>
                                        <td style={styles.td}>{formatTimestamp(loan.waktuPengajuan)}</td>
                                        <td style={styles.td}>
                                            <button
                                                style={{...styles.buttonAlt, fontSize: '12px', padding: '5px 10px', marginBottom: 0}}
                                                onClick={() => handleSetujuiPinjaman(loan.id)}
                                                disabled={isLoading}
                                            >
                                                {isLoading ? "..." : "Setujui"}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                         </table>
                         </div>
                    ) : (
                        <p>Tidak ada pengajuan pinjaman yang menunggu persetujuan.</p>
                    )}
                     {/* Input manual masih ada sebagai fallback */}
                     <input
                        style={{...styles.input, marginTop: '20px'}}
                        type="number"
                        value={idPinjamanAdmin}
                        onChange={(e) => setIdPinjamanAdmin(e.target.value)}
                        placeholder="Atau masukkan ID Pinjaman manual"
                        min="1"
                        disabled={isLoading}
                    />
                    <button style={{...styles.buttonAlt, marginTop: '10px'}} onClick={() => handleSetujuiPinjaman(idPinjamanAdmin)} disabled={isLoading || !idPinjamanAdmin || parseInt(idPinjamanAdmin, 10) <= 0}>
                        {isLoading ? "Memproses..." : "Setujui ID Manual"}
                    </button>
                </div>
            )}

            {userAccount && anggotaData !== null && anggotaData.terdaftar && (
                 <div style={styles.card}>
                    <h4>Riwayat Transaksi (dari Events)</h4>
                    <button style={styles.buttonAlt} onClick={() => fetchUserData(userAccount, koperasiContract, idrTokenContract)} disabled={isLoading || loadingLoans}>
                        {isLoading || loadingLoans ? "Memuat..." : "Refresh Riwayat & Data"}
                    </button>
                    <ul style={styles.historyList}>
                        {history.length > 0 ? history.map((log, index) => (
                            <li key={`${log.transactionHash}-${log.logIndex || index}`}>{renderHistoryItem(log)}</li>
                        )) : (
                            <li>Tidak ada riwayat transaksi ditemukan.</li>
                        )}
                    </ul>
                 </div>
            )}

        </div>
    );
}

// --- CSS STYLING ---
const styles = {
    container: { fontFamily: 'Arial, sans-serif', maxWidth: '800px', margin: '20px auto', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' },
    title: { textAlign: 'center', color: '#333', marginBottom: '30px' }, // Added marginBottom
    message: { textAlign: 'center', padding: '12px', margin: '15px 0', backgroundColor: '#e9ecef', borderRadius: '5px', color: '#495057', border: '1px solid #ced4da', wordWrap: 'break-word', minHeight: '1.5em' },
    address: { wordWrap: 'break-word', fontSize: '0.9em', color: '#6c757d' },
    addressSmall: { wordWrap: 'break-word', fontSize: '0.85em', color: '#6c757d' }, // Smaller address for table
    card: { backgroundColor: '#ffffff', border: '1px solid #dee2e6', borderRadius: '8px', padding: '25px', margin: '20px 0', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }, // Increased padding
    input: { boxSizing: 'border-box', width: '100%', padding: '10px 12px', margin: '10px 0', border: '1px solid #ced4da', borderRadius: '4px', fontSize: '16px', transition: 'border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out' },
    button: { backgroundColor: '#007bff', color: 'white', border: 'none', padding: '12px 20px', borderRadius: '5px', cursor: 'pointer', fontSize: '16px', width: '100%', transition: 'background-color 0.3s', marginTop: '5px' },
    buttonAlt: { backgroundColor: '#ffc107', color: '#212529', border: 'none', padding: '10px 15px', borderRadius: '5px', cursor: 'pointer', fontSize: '14px', marginBottom: '10px', transition: 'background-color 0.3s' },
    historyList: { listStyleType: 'none', padding: '15px', margin: '10px 0 0 0', maxHeight: '350px', overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: '5px', backgroundColor: '#f8f9fa', fontSize: '14px', lineHeight: '1.7' },
    // [PENAMBAHAN] Style untuk tabel admin
    tableContainer: { overflowX: 'auto', marginTop: '15px' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
    th: { border: '1px solid #dee2e6', padding: '8px 10px', textAlign: 'left', backgroundColor: '#e9ecef', fontWeight: 'bold' },
    td: { border: '1px solid #dee2e6', padding: '8px 10px', verticalAlign: 'top' }, // Added verticalAlign
};

export default App;