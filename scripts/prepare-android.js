// scripts/prepare-android.js
// Configura automáticamente AndroidManifest.xml, banners 16:9 y recursos para Android TV en compilaciones locales
import fs from 'fs';
import path from 'path';

const ANDROID_RES = path.resolve('android/app/src/main/res');
const MANIFEST_PATH = path.resolve('android/app/src/main/AndroidManifest.xml');

function configureManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log('[prepare-android] AndroidManifest.xml no encontrado. Ejecuta primero "npx cap add android".');
    return;
  }

  let m = fs.readFileSync(MANIFEST_PATH, 'utf-8');

  // 1. Features Leanback
  if (!m.includes('android.software.leanback')) {
    m = m.replace(
      /(<manifest[^>]*>)/,
      '$1\n    <uses-feature android:name="android.software.leanback" android:required="false" />\n    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />'
    );
  }

  // 2. Banner y cleartext en <application>
  if (!m.includes('android:banner=')) {
    m = m.replace('<application', '<application android:banner="@drawable/banner" android:logo="@drawable/banner" android:usesCleartextTraffic="true"');
  } else if (!m.includes('android:usesCleartextTraffic=')) {
    m = m.replace('<application', '<application android:usesCleartextTraffic="true"');
  }

  // 3. Banner e icono en MainActivity
  m = m.replace(/<activity\b[^>]*MainActivity[^>]*>/, (tag) => {
    if (!tag.includes('android:banner=')) {
      tag = tag.replace(/>$/, ' android:banner="@drawable/banner" android:icon="@drawable/banner" android:logo="@drawable/banner">');
    } else if (!tag.includes('android:icon=')) {
      tag = tag.replace(/>$/, ' android:icon="@drawable/banner">');
    }
    return tag;
  });

  // 4. Intent filter LEANBACK_LAUNCHER
  if (!m.includes('LEANBACK_LAUNCHER')) {
    const leanbackFilter = `            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>`;
    m = m.replace(/(<intent-filter\b[\s\S]*?android\.intent\.category\.LAUNCHER[\s\S]*?<\/intent-filter>)/, `${leanbackFilter}\n$1`);
  }

  fs.writeFileSync(MANIFEST_PATH, m, 'utf-8');
  console.log('[prepare-android] AndroidManifest.xml configurado correctamente para Android TV.');
}

function copyBanners() {
  const candidates = [
    'public/icons/icon-landscape.alt2.png',
    'public/icons/icon-landscape.alt.png',
    'public/icons/icon-landscape.png'
  ];

  const bannerSrc = candidates.find(c => fs.existsSync(path.resolve(c)));
  if (!bannerSrc) {
    console.warn('[prepare-android] No se encontró imagen de banner en public/icons/');
    return;
  }

  const srcBuffer = fs.readFileSync(path.resolve(bannerSrc));
  const folders = [
    'drawable',
    'drawable-mdpi',
    'drawable-tvdpi',
    'drawable-hdpi',
    'drawable-xhdpi',
    'drawable-xxhdpi',
    'drawable-xxxhdpi',
    'mipmap-mdpi',
    'mipmap-tvdpi',
    'mipmap-hdpi',
    'mipmap-xhdpi',
    'mipmap-xxhdpi',
    'mipmap-xxxhdpi'
  ];

  folders.forEach(folder => {
    const targetDir = path.join(ANDROID_RES, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(path.join(targetDir, 'banner.png'), srcBuffer);
    fs.writeFileSync(path.join(targetDir, 'tv_banner.png'), srcBuffer);
  });

  console.log(`[prepare-android] Banners 16:9 inyectados desde ${bannerSrc} en carpetas de recursos.`);
}

function configureStyles() {
  const stylePaths = [
    path.join(ANDROID_RES, 'values/styles.xml'),
    path.join(ANDROID_RES, 'values-night/styles.xml')
  ];

  stylePaths.forEach(sp => {
    if (fs.existsSync(sp)) {
      let st = fs.readFileSync(sp, 'utf-8');
      if (st.includes('android:windowBackground')) {
        st = st.replace(/<item name="android:windowBackground">[^<]+<\/item>/, '<item name="android:windowBackground">@android:color/black</item>');
      } else {
        st = st.replace('</style>', '    <item name="android:windowBackground">@android:color/black</item>\n    </style>');
      }
      fs.writeFileSync(sp, st, 'utf-8');
    }
  });
  console.log('[prepare-android] Fondo negro configurado en styles.xml.');
}

try {
  configureManifest();
  copyBanners();
  configureStyles();
  console.log('[prepare-android] Preparación para Android completada con éxito.');
} catch (err) {
  console.error('[prepare-android] Error:', err);
}
