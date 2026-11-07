# iPhone distribution options

Updated: 2026-11-07. Anthony accepted a Home Screen PWA. Hosting and installation
have not been configured. See [ADR-0007](adr/0007-deliver-kuwi-as-a-pwa.md).

| Option | Cost and renewal | Implication for Kuwi |
| --- | --- | --- |
| Free Personal Team install from Xcode | No Apple membership fee; provisioning expires after seven days | Supports early physical-device tests, with periodic renewal and reinstalling. |
| AltStore Classic refresh | Retains Apple's seven-day expiry; attempts automatic refresh through AltServer | Can reduce manual renewal. AltServer must be reachable over the same Wi-Fi network or USB for refresh. Not configured or tested here. |
| Paid Apple Developer Program | 99 USD per membership year, with regional pricing; TestFlight builds last up to 90 days | Supports beta distribution and App Store submission. This is separate from backend hosting costs. |
| Home Screen PWA | No Apple membership or native provisioning renewal | Can provide web-based tracking, offline storage, and supported web notifications. Native extensions remain necessary for full iPhone integration. |

Sources: [Apple free-account limits](https://developer.apple.com/help/account/basics/about-your-developer-account),
[AltStore refresh](https://faq.altstore.io/altstore-classic/altserver),
[Apple membership](https://developer.apple.com/programs/whats-included/),
[TestFlight expiry](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

## PWA tradeoffs

WebKit supports [Home Screen web apps and web push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
without Apple Developer Program membership. Web storage supports offline use,
but requires a persistence, backup, and recovery design under
[WebKit's storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).
The accepted PWA decision reopens the native SQLite implementation. Browser
SQLite and IndexedDB remain candidates; neither has been accepted or tested on
Anthony's iPhone. See [browser storage research](pwa-storage-research.md).

Apple's [WidgetKit integration](https://developer.apple.com/documentation/widgetkit/developing-a-widgetkit-strategy)
uses app extensions for widgets, watch complications, and Live Activities.
A PWA alone cannot supply those native targets. Anthony clarified that Kuwi's
target is Tarsi's refined interface, animations, and finance logic. Native
widgets, Watch apps, and other Apple integrations are outside this delivery.
No later native app is committed. The native installation options above remain
background comparisons, not the current plan.

Expo Go is not a general current-SDK workaround. Expo's
[version guidance](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/)
says its iOS App Store build stops at SDK 54; newer SDKs use another installation
route, including TestFlight. It also cannot load arbitrary custom native code.
No Expo framework decision has been made for Kuwi.
