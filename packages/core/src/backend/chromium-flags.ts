/**
 * Command-line flags for launching a stock Chromium or Chrome (the CLI, and
 * tests). Without them Chromium quietly contacts Google in the background
 * (component updates via redirector.gvt1.com, www.google.com probes, and so on),
 * which would break the promise that nothing is sent except the pages the user
 * visits. Found by watching egress while running the integration tests.
 */
export const PRIVATE_CHROMIUM_ARGS: readonly string[] = [
  '--force-renderer-accessibility',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--disable-client-side-phishing-detection',
  '--disable-default-apps',
  '--disable-breakpad',
  '--no-pings',
  '--no-first-run',
  '--no-default-browser-check',
  '--metrics-recording-only',
  '--dns-prefetch-disable',
  // Background-only Google infrastructure that no web page needs: device
  // check-in, component and extension updates, dictionaries. Sites people
  // actually visit (google.com, accounts.google.com) are deliberately NOT
  // blocked, since users may want to use them.
  '--host-resolver-rules=' +
    [
      'android.clients.google.com',
      'redirector.gvt1.com',
      '*.gvt1.com',
      'update.googleapis.com',
      'clients2.google.com',
      'clients2.googleusercontent.com',
      'safebrowsing.googleapis.com',
      'optimizationguide-pa.googleapis.com',
      'content-autofill.googleapis.com',
    ]
      .map((h) => `MAP ${h} ~NOTFOUND`)
      .join(', '),
  '--disable-features=AccountConsistency,MirrorAccountConsistency,ChromeSignin,OptimizationHints,OptimizationGuideModelDownloading,MediaRouter,Translate,AutofillServerCommunication,CertificateTransparencyComponentUpdater,InterestFeedContentSuggestions,NetworkTimeServiceQuerying,SpareRendererForSitePerProcess',
];
