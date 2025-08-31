// Global variables
let app, db, auth;
let userId;
let sessionDocRef;
let player;
let isVideoSyncing = false;
let isHost = false;

// --- Firebase & App Initialization ---
async function initializeFirebase() {
    // ⚠️ IMPORTANT: Paste your firebaseConfig object here ⚠️
    const firebaseConfig = {
      apiKey: "YOUR_API_KEY",
      authDomain: "YOUR_AUTH_DOMAIN",
      projectId: "YOUR_PROJECT_ID",
      storageBucket: "YOUR_STORAGE_BUCKET",
      messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
      appId: "YOUR_APP_ID"
    };

    if (Object.keys(firebaseConfig).length === 0) {
        console.error("Firebase config is missing. Please provide a valid configuration.");
        return;
    }

    try {
        app = firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();

        // Enable Anonymous Authentication
        await auth.signInAnonymously();
        userId = auth.currentUser?.uid || crypto.randomUUID();
        
        setupYouTubePlayer();

        // Add event listeners for buttons
        document.getElementById('create-party-btn').addEventListener('click', () => {
            const partyId = document.getElementById('party-id-input').value.trim() || crypto.randomUUID().substring(0, 8);
            joinOrCreateParty(partyId, true);
        });

        document.getElementById('join-party-btn').addEventListener('click', () => {
            const partyId = document.getElementById('party-id-input').value.trim();
            if (partyId) {
                joinOrCreateParty(partyId, false);
            } else {
                console.error('Please enter a Party ID to join.');
            }
        });

        document.getElementById('load-video-btn').addEventListener('click', () => {
            const url = document.getElementById('youtube-url-input').value;
            const videoId = extractYouTubeId(url);
            if (videoId) {
                updateVideoState({ videoId: videoId, currentTime: 0, isPlaying: false });
                player.loadVideoById(videoId);
            } else {
                console.error('Invalid YouTube URL or ID.');
            }
        });

        document.getElementById('play-pause-btn').addEventListener('click', () => {
            if (player.getPlayerState() === YT.PlayerState.PLAYING) {
                player.pauseVideo();
            } else {
                player.playVideo();
            }
        });

    } catch (error) {
        console.error("Firebase initialization or authentication failed:", error);
    }
}

// --- Watch Party Logic (Firestore) ---
async function joinOrCreateParty(partyId, isCreating) {
    sessionDocRef = db.collection('watch-parties').doc(partyId);
    document.getElementById('current-party-id').textContent = `Session ID: ${partyId}`;

    const docSnap = await sessionDocRef.get();
    if (isCreating && !docSnap.exists()) {
        isHost = true;
        console.log("Creating new watch party. You are the host.");
        await sessionDocRef.set({
            videoId: '',
            isPlaying: false,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdatedBy: userId,
        });
    } else if (docSnap.exists()) {
        isHost = false;
        console.log("Joining existing watch party.");
    } else {
        console.error("Party does not exist. Please check the ID or create a new party.");
        return;
    }

    // Real-time listener for video state changes
    sessionDocRef.onSnapshot((doc) => {
        if (doc.exists() && player) {
            const data = doc.data();
            if (data.lastUpdatedBy !== userId && !isVideoSyncing) {
                console.log("Syncing video state from Firestore...");
                
                // Load video if different
                if (player.getVideoUrl() && !player.getVideoUrl().includes(data.videoId) && data.videoId) {
                    player.loadVideoById(data.videoId);
                }

                // Sync play/pause state
                if (data.isPlaying && player.getPlayerState() !== 1) {
                    player.playVideo();
                } else if (!data.isPlaying && player.getPlayerState() === 1) {
                    player.pauseVideo();
                }

                // Sync video time
                const timeDifference = Math.abs(player.getCurrentTime() - data.currentTime);
                if (timeDifference > 2) {
                    player.seekTo(data.currentTime, true);
                }
            }
        }
    });
}

async function updateVideoState(state) {
    if (sessionDocRef) {
        isVideoSyncing = true;
        await sessionDocRef.update({
            ...state,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdatedBy: userId
        });
        // Debounce sync updates
        setTimeout(() => { isVideoSyncing = false; }, 1000);
    }
}

// --- YouTube Player API ---
function setupYouTubePlayer() {
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: 'dQw4w9WgXcQ', // Default video
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        },
    });
};

function onPlayerReady(event) {
    console.log("YouTube Player is ready.");
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        updateVideoState({ isPlaying: true, currentTime: player.getCurrentTime() });
    } else if (event.data === YT.PlayerState.PAUSED) {
        updateVideoState({ isPlaying: false, currentTime: player.getCurrentTime() });
    }
}

function extractYouTubeId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/;
    const match = url.match(regex);
    return (match && match[1]) || url;
}

// Initialize the app on page load
document.addEventListener('DOMContentLoaded', initializeFirebase);