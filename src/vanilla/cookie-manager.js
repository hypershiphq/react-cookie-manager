// Import Tailwind styles
import "./cookie-manager.css";
import { getBlockedHosts, getBlockedKeywords } from "./tracker-utils.js";
import { timezoneToCountryCodeMap } from "../utils/timeZoneMap";

// Store original functions
let originalXhrOpen = null;
let originalFetch = null;

// Utility functions for consent logging
const resolveCountryFromTimezone = (timeZone) => {
  const entry = timezoneToCountryCodeMap[timeZone]?.a
    ? timezoneToCountryCodeMap[timezoneToCountryCodeMap[timeZone].a]
    : timezoneToCountryCodeMap[timeZone];

  return entry?.c?.[0] ?? "Unknown";
};

const postConsentToAnalytics = async (
  kitId,
  sessionId,
  action,
  preferences,
  userId
) => {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const country = resolveCountryFromTimezone(timeZone);
    const domain = window.location.hostname;

    await fetch("https://cookiekit.io/api/consents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        website_id: kitId,
        session_id: sessionId,
        user_id: userId,
        analytics: preferences?.analytics ?? false,
        social: preferences?.marketing ?? false,
        advertising: preferences?.preferences ?? false,
        consent_method: action || "init",
        consent_version: "1.0",
        user_agent: navigator.userAgent,
        location: country,
        anonymised_ip: "0.0.0.0",
        domain: domain,
      }),
    });
  } catch (error) {
    // Silent fail
  }
};

// Simple session ID generation
const generateSessionId = (kitId) => {
  if (!kitId) return null;

  const timestamp = new Date().getTime();
  const random = Math.random().toString(36).substring(2, 10);
  return `${kitId}_${timestamp}_${random}`;
};

// Check if session is expired (older than 365 days)
const isSessionExpired = (sessionId) => {
  if (!sessionId) return true;

  // Extract timestamp from session ID (format: kitId_timestamp_random)
  const timestamp = parseInt(sessionId.split("_")[1]);
  if (isNaN(timestamp)) return true;

  const now = new Date().getTime();
  const age = now - timestamp;
  const maxAge = 365 * 24 * 60 * 60 * 1000; // 365 days in milliseconds

  return age > maxAge;
};

const blockTrackingRequests = (blockedHosts) => {
  // Store original functions if not already stored
  if (!originalXhrOpen) {
    originalXhrOpen = XMLHttpRequest.prototype.open;
  }
  if (!originalFetch) {
    originalFetch = window.fetch;
  }

  // Override XMLHttpRequest to block requests to tracking domains
  XMLHttpRequest.prototype.open = function (method, url) {
    const urlString = url.toString();

    // Check if domain is whitelisted
    if (window.CookieKit.manager?.config.allowedDomains?.length > 0) {
      if (
        window.CookieKit.manager.config.allowedDomains.some((domain) =>
          urlString.includes(domain)
        )
      ) {
        return originalXhrOpen.apply(this, arguments);
      }
    }

    if (blockedHosts.some((host) => urlString.includes(host))) {
      throw new Error("Request blocked by consent settings");
    }
    return originalXhrOpen.apply(this, arguments);
  };

  // Override fetch API to block tracking requests
  window.fetch = function (url, options) {
    const urlString = url.toString();

    // Check if domain is whitelisted
    if (window.CookieKit.manager?.config.allowedDomains?.length > 0) {
      if (
        window.CookieKit.manager.config.allowedDomains.some((domain) =>
          urlString.includes(domain)
        )
      ) {
        return originalFetch.apply(this, arguments);
      }
    }

    if (
      typeof urlString === "string" &&
      blockedHosts.some((host) => urlString.includes(host))
    ) {
      return Promise.resolve(
        new Response(null, { status: 403, statusText: "Blocked" })
      );
    }
    return originalFetch.apply(this, arguments);
  };
};

const blockTrackingScripts = (trackingKeywords) => {
  // Remove all script tags that match tracking domains
  document.querySelectorAll("script").forEach((script) => {
    if (
      script.src &&
      trackingKeywords.some((keyword) => script.src.includes(keyword))
    ) {
      script.remove();
    }
  });

  // Also block iframes from tracking domains (especially for YouTube embeds)
  document.querySelectorAll("iframe").forEach((iframe) => {
    if (
      iframe.src &&
      trackingKeywords.some((keyword) => iframe.src.includes(keyword))
    ) {
      console.debug(`[CookieKit] Blocking iframe: ${iframe.src}`);

      // Get the original iframe dimensions - be more precise about capturing dimensions
      let width = "100%";
      let height = "315px";

      // Try to get the most accurate dimensions possible
      if (iframe.width) {
        width =
          iframe.width +
          (iframe.width.toString().match(/^[0-9]+$/) ? "px" : "");
      } else if (iframe.style.width) {
        width = iframe.style.width;
      } else if (iframe.getAttribute("width")) {
        width =
          iframe.getAttribute("width") +
          (iframe.getAttribute("width").match(/^[0-9]+$/) ? "px" : "");
      }

      if (iframe.height) {
        height =
          iframe.height +
          (iframe.height.toString().match(/^[0-9]+$/) ? "px" : "");
      } else if (iframe.style.height) {
        height = iframe.style.height;
      } else if (iframe.getAttribute("height")) {
        height =
          iframe.getAttribute("height") +
          (iframe.getAttribute("height").match(/^[0-9]+$/) ? "px" : "");
      }

      // For YouTube embeds in responsive containers, check for parent with padding-bottom style
      if (iframe.parentElement) {
        const parentStyle = window.getComputedStyle(iframe.parentElement);
        if (parentStyle.paddingBottom && parentStyle.paddingBottom !== "0px") {
          // Use the same aspect ratio as the container
          height = "0";
          width = "100%";

          // Create a placeholder that preserves aspect ratio
          const placeholder = document.createElement("div");
          placeholder.className = "cookie-consent-blocked-iframe";
          placeholder.style.cssText = `
            position: relative;
            width: ${width}; 
            padding-bottom: ${parentStyle.paddingBottom}; 
            background-color: rgba(31, 41, 55, 0.95);
            border-radius: 6px;
            border: 1px solid #4b5563;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            overflow: hidden;
          `;

          const content = document.createElement("div");
          content.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #f3f4f6;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            text-align: center;
            padding: 20px;
          `;

          content.innerHTML = `
            <div style="font-size: 28px; margin-bottom: 10px;">🔒</div>
            <h3 style="font-size: 16px; margin: 0 0 10px 0; font-weight: bold; color: white;">Content Blocked</h3>
            <p style="margin: 0 0 10px 0; font-size: 14px;">This content requires cookies that are currently blocked by your privacy settings.</p>
            <p style="margin: 0 0 10px 0; font-size: 14px;">Refresh the page to view this content after adjusting your cookie settings.</p>
            <button onclick="window.CookieKit.showCustomizeModal()" style="margin-top: 10px; background-color: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: 500; cursor: pointer; font-size: 13px;">
              Manage Cookie Settings
            </button>
          `;

          placeholder.appendChild(content);
          iframe.parentNode?.replaceChild(placeholder, iframe);
          return;
        }
      }

      // Standard placeholder for non-responsive containers
      const placeholder = document.createElement("div");
      placeholder.className = "cookie-consent-blocked-iframe";
      placeholder.style.cssText = `
        width: ${width}; 
        height: ${height}; 
        background-color: rgba(31, 41, 55, 0.95);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        border: 1px solid #4b5563;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        color: #f3f4f6;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        text-align: center;
        padding: 20px;
      `;
      placeholder.innerHTML = `
        <div style="font-size: 28px; margin-bottom: 10px;">🔒</div>
        <h3 style="font-size: 16px; margin: 0 0 10px 0; font-weight: bold; color: white;">Content Blocked</h3>
        <p style="margin: 0 0 10px 0; font-size: 14px;">This content requires cookies that are currently blocked by your privacy settings.</p>
        <button onclick="window.CookieKit.showCustomizeModal()" style="margin-top: 10px; background-color: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: 500; cursor: pointer; font-size: 13px;">
          Manage Cookie Settings
        </button>
      `;
      iframe.parentNode?.replaceChild(placeholder, iframe);
    }
  });

  // Prevent new tracking scripts and iframes from being injected
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        // Handle script tags
        if (node instanceof HTMLElement && node.tagName === "SCRIPT") {
          const src = node.getAttribute("src");
          if (
            src &&
            trackingKeywords.some((keyword) => src.includes(keyword))
          ) {
            node.remove();
          }
        }

        // Handle iframe tags (especially YouTube)
        if (node instanceof HTMLElement && node.tagName === "IFRAME") {
          const src = node.getAttribute("src");
          if (
            src &&
            trackingKeywords.some((keyword) => src.includes(keyword))
          ) {
            console.debug(`[CookieKit] Blocking injected iframe: ${src}`);

            // Get the original iframe dimensions - be more precise about capturing dimensions
            let width = "100%";
            let height = "315px";

            // Try to get the most accurate dimensions possible
            if (node.width) {
              width =
                node.width +
                (node.width.toString().match(/^[0-9]+$/) ? "px" : "");
            } else if (node.style.width) {
              width = node.style.width;
            } else if (node.getAttribute("width")) {
              width =
                node.getAttribute("width") +
                (node.getAttribute("width").match(/^[0-9]+$/) ? "px" : "");
            }

            if (node.height) {
              height =
                node.height +
                (node.height.toString().match(/^[0-9]+$/) ? "px" : "");
            } else if (node.style.height) {
              height = node.style.height;
            } else if (node.getAttribute("height")) {
              height =
                node.getAttribute("height") +
                (node.getAttribute("height").match(/^[0-9]+$/) ? "px" : "");
            }

            // For YouTube embeds in responsive containers, check for parent with padding-bottom style
            if (node.parentElement) {
              const parentStyle = window.getComputedStyle(node.parentElement);
              if (
                parentStyle.paddingBottom &&
                parentStyle.paddingBottom !== "0px"
              ) {
                // Use the same aspect ratio as the container
                height = "0";
                width = "100%";

                // Create a placeholder that preserves aspect ratio
                const placeholder = document.createElement("div");
                placeholder.className = "cookie-consent-blocked-iframe";
                placeholder.style.cssText = `
                  position: relative;
                  width: ${width}; 
                  padding-bottom: ${parentStyle.paddingBottom}; 
                  background-color: rgba(31, 41, 55, 0.95);
                  border-radius: 6px;
                  border: 1px solid #4b5563;
                  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                  overflow: hidden;
                `;

                const content = document.createElement("div");
                content.style.cssText = `
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  color: #f3f4f6;
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                  text-align: center;
                  padding: 20px;
                `;

                content.innerHTML = `
                  <div style="font-size: 28px; margin-bottom: 10px;">🔒</div>
                  <h3 style="font-size: 16px; margin: 0 0 10px 0; font-weight: bold; color: white;">Content Blocked</h3>
                  <p style="margin: 0 0 10px 0; font-size: 14px;">This content requires cookies that are currently blocked by your privacy settings.</p>
                  <p style="margin: 0 0 10px 0; font-size: 14px;">Refresh the page to view this content after adjusting your cookie settings.</p>
                  <button onclick="window.CookieKit.showCustomizeModal()" style="margin-top: 10px; background-color: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: 500; cursor: pointer; font-size: 13px;">
                    Manage Cookie Settings
                  </button>
                `;

                placeholder.appendChild(content);
                node.parentNode?.replaceChild(placeholder, node);
                return;
              }
            }

            // Standard placeholder for non-responsive containers
            const placeholder = document.createElement("div");
            placeholder.className = "cookie-consent-blocked-iframe";
            placeholder.style.cssText = `
              width: ${width}; 
              height: ${height}; 
              background-color: rgba(31, 41, 55, 0.95);
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              border-radius: 6px;
              border: 1px solid #4b5563;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
              color: #f3f4f6;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              text-align: center;
              padding: 20px;
            `;
            placeholder.innerHTML = `
              <div style="font-size: 28px; margin-bottom: 10px;">🔒</div>
              <h3 style="font-size: 16px; margin: 0 0 10px 0; font-weight: bold; color: white;">Content Blocked</h3>
              <p style="margin: 0 0 10px 0; font-size: 14px;">This content requires cookies that are currently blocked by your privacy settings.</p>
              <p style="margin: 0 0 10px 0; font-size: 14px;">Refresh the page to view this content after adjusting your cookie settings.</p>
              <button onclick="window.CookieKit.showCustomizeModal()" style="margin-top: 10px; background-color: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: 500; cursor: pointer; font-size: 13px;">
                Manage Cookie Settings
              </button>
            `;
            node.parentNode?.replaceChild(placeholder, node);
          }
        }
      });
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  return observer;
};

const restoreOriginalRequests = () => {
  if (originalXhrOpen) {
    XMLHttpRequest.prototype.open = originalXhrOpen;
  }
  if (originalFetch) {
    window.fetch = originalFetch;
  }
};

// Remove the import and export, make it a pure IIFE
(function () {
  class CookieManager {
    constructor(config) {
      // Create a copy of config without translations to prevent overwriting
      const configWithoutTranslations = { ...(config || {}) };
      delete configWithoutTranslations.translations;

      this.config = {
        cookieName: "cookie_consent",
        cookieExpiration: 365,
        style: "banner", // banner, modal, or popup
        theme: "light", // light or dark
        cookieKitId: "", // unique identifier
        categories: {
          analytics: false,
          marketing: false,
          preferences: false,
        },
        allowedDomains: [], // Domains that should never be blocked
        translations: {
          title: "Would You Like A Cookie? 🍪",
          message:
            "We use cookies to enhance your browsing experience and analyze our traffic.",
          buttonText: "Accept All",
          declineButtonText: "Decline All",
          manageButtonText: "Customize",
          privacyPolicyText: "Privacy Policy",
          manageTitle: "Cookie Preferences",
          manageMessage: "Choose which cookies you want to accept.",
          savePreferences: "Save Preferences",
          cancel: "Cancel",
          ...(config?.translations || {}),
        },
        disableAutomaticBlocking: false,
        blockedDomains: [],
        ...configWithoutTranslations,
      };

      this.state = this.loadConsent();

      // Store original functions if not already stored
      if (!originalXhrOpen) {
        originalXhrOpen = XMLHttpRequest.prototype.open;
      }
      if (!originalFetch) {
        originalFetch = window.fetch;
      }

      // Override XMLHttpRequest to block requests to tracking domains
      const self = this; // Store reference to this for use in function
      XMLHttpRequest.prototype.open = function (method, url) {
        const urlString = url.toString();

        if (self.shouldBlockRequest(urlString)) {
          throw new Error("Request blocked by consent settings");
        }

        return originalXhrOpen.apply(this, arguments);
      };

      // Override fetch API to block tracking requests
      window.fetch = function (url, options) {
        const urlString = url.toString();

        if (self.shouldBlockRequest(urlString)) {
          return Promise.resolve(
            new Response(null, {
              status: 403,
              statusText: "Blocked by consent settings",
            })
          );
        }

        return originalFetch.apply(this, arguments);
      };

      // Initialize blocking based on current consent
      this.initializeBlocking();

      // Generate session if kitId exists
      if (this.config.cookieKitId) {
        const sessionKey = "cookie_consent-session";
        let sessionId = this.getCookie(sessionKey);

        // Check if session exists and is not expired
        if (!sessionId || isSessionExpired(sessionId)) {
          sessionId = generateSessionId(this.config.cookieKitId);
          if (sessionId) {
            this.setCookie(sessionKey, sessionId, 365); // Set to expire in 365 days
            // Post initial consent
            postConsentToAnalytics(
              this.config.cookieKitId,
              sessionId,
              "init",
              null,
              this.config.userId
            );
          }
        }
      }
    }

    initializeBlocking() {
      if (this.config.disableAutomaticBlocking) {
        return;
      }

      // Get current preferences
      const currentPreferences = this.state
        ? {
            analytics: this.state.analytics,
            marketing: this.state.marketing,
            preferences: this.state.preferences,
          }
        : null;

      // Get blocked hosts and keywords based on preferences
      const blockedHosts = [
        ...getBlockedHosts(currentPreferences),
        ...this.config.blockedDomains,
      ];
      const blockedKeywords = [
        ...getBlockedKeywords(currentPreferences),
        ...this.config.blockedDomains,
      ];

      if (blockedHosts.length > 0) {
        blockTrackingRequests(blockedHosts);
        this.observer = blockTrackingScripts(blockedKeywords);
      } else {
        restoreOriginalRequests();
        if (this.observer) {
          this.observer.disconnect();
          this.observer = null;
        }
      }
    }

    injectStyles(cssContent) {
      const styleSheet = document.createElement("style");
      styleSheet.textContent = cssContent;
      document.head.appendChild(styleSheet);
    }

    loadConsent() {
      const consent = this.getCookie(this.config.cookieName);
      return consent ? JSON.parse(consent) : null;
    }

    setCookie(name, value, days) {
      const date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/;SameSite=Lax`;
    }

    getCookie(name) {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) {
        return parts.pop()?.split(";").shift() || null;
      }
      return null;
    }

    deleteCookie(name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }

    saveConsent(categories) {
      // Debug log to help diagnose issues
      console.log(`Saving consent for style: ${this.config.style}`, categories);

      // Animate out and then hide
      if (this.wrapper) {
        // For popup style, we need to handle it differently
        if (this.config.style === "popup") {
          // Immediately hide the wrapper
          this.wrapper.style.display = "none";
        } else {
          // For banner and modal styles, use animation
          const banner = this.wrapper.querySelector('div[class*="fixed"]');
          if (banner) {
            banner.classList.add("translate-y-full");
            setTimeout(() => {
              this.wrapper.style.display = "none";
            }, 300); // Increased timeout to ensure animation completes
          } else {
            this.wrapper.style.display = "none";
          }
        }
      }

      if (this.modalWrapper) {
        this.modalWrapper.classList.add("opacity-0");
        setTimeout(() => {
          this.modalWrapper.style.display = "none";
        }, 300); // Increased timeout to ensure animation completes
      }

      this.state = categories;
      this.setCookie(
        this.config.cookieName,
        JSON.stringify(categories),
        this.config.cookieExpiration
      );

      // Post consent to analytics if we have a kitId
      if (this.config.cookieKitId) {
        const sessionKey = "cookie_consent-session";
        const sessionId = this.getCookie(sessionKey);
        if (sessionId) {
          // Determine the action based on the consent type
          let action = "save_preferences";
          if (Object.values(categories).every((val) => val === true)) {
            action = "accept";
          } else if (Object.values(categories).every((val) => val === false)) {
            action = "decline";
          }

          postConsentToAnalytics(
            this.config.cookieKitId,
            sessionId,
            action,
            categories,
            this.config.userId
          );
        }
      }

      // Reinitialize blocking based on new consent
      this.initializeBlocking();

      this.applyConsent();
    }

    applyConsent() {
      if (this.state?.analytics) {
        document
          .querySelectorAll('script[data-cookiekit="analytics"]')
          .forEach((script) => script.setAttribute("type", "text/javascript"));
      }

      if (this.state?.marketing) {
        document
          .querySelectorAll('script[data-cookiekit="marketing"]')
          .forEach((script) => script.setAttribute("type", "text/javascript"));
      }

      window.dispatchEvent(
        new CustomEvent("cookiekit:consent-updated", {
          detail: this.state,
        })
      );
    }

    createBanner() {
      const wrapper = document.createElement("div");
      wrapper.className = "cookie-manager";

      // If the style is modal, add an overlay background
      if (this.config.style === "modal") {
        const bannerOverlay = document.createElement("div");
        bannerOverlay.className =
          "fixed inset-0 bg-black/40 backdrop-blur-sm z-[9998]";
        wrapper.appendChild(bannerOverlay);
      }

      const banner = document.createElement("div");
      const isLight = this.config.theme === "light";

      // Base classes for all styles
      const baseClasses = `fixed z-[9999] font-sans transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]`;

      // Mobile-first base positioning - start from below screen and animate up
      const mobileClasses =
        "bottom-0 left-0 w-full translate-y-full animate-in duration-500";

      // Desktop-specific classes
      const desktopClasses = {
        banner:
          "md:bottom-4 md:left-1/2 md:-translate-x-1/2 md:translate-y-0 md:w-full md:max-w-2xl",
        modal:
          "md:inset-0 md:flex md:items-center md:justify-center md:p-4 md:translate-y-0",
        popup: "md:bottom-4 md:left-4 md:translate-y-0 md:w-80",
      }[this.config.style];

      banner.className = `${baseClasses} ${mobileClasses} ${desktopClasses}`;

      // Trigger the animation after a brief delay
      setTimeout(() => {
        banner.classList.remove("translate-y-full");
      }, 100);

      const contentBaseClasses = `
        rounded-t-lg md:rounded-lg backdrop-blur-sm backdrop-saturate-150 
        ${
          isLight
            ? "bg-white/95 border border-black/10 shadow-lg"
            : "bg-black/95 ring-1 ring-white/10"
        }
      `;

      // Content-specific classes
      const contentClasses = {
        banner:
          "p-4 md:hover:-translate-y-2 md:transition-transform md:duration-500",
        modal: "p-4 md:w-full md:max-w-lg md:p-6",
        popup:
          "p-4 md:hover:-translate-y-2 md:transition-transform md:duration-500",
      }[this.config.style];

      banner.innerHTML = `
        <div class="${contentBaseClasses} ${contentClasses}">
          <div class="flex flex-col gap-4">
            <div>
              <h2 class="text-base md:text-sm font-semibold mb-2 ${
                isLight ? "text-gray-900" : "text-white"
              }">${this.config.translations.title}</h2>
              <p class="text-sm md:text-xs font-medium ${
                isLight ? "text-gray-700" : "text-gray-200"
              }">${this.config.translations.message}</p>
            </div>
            ${
              this.config.style === "popup"
                ? `
                <div class="flex flex-col gap-3 w-full">
                  <!-- Mobile buttons -->
                  <button class="accept-all w-full md:hidden px-4 py-2.5 text-sm font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-all duration-200 hover:scale-105">
                    ${this.config.translations.buttonText}
                  </button>
                  <button class="decline-all w-full md:hidden px-4 py-2.5 text-sm font-medium rounded-md ${
                    isLight
                      ? "bg-gray-200 hover:bg-gray-300 text-gray-800"
                      : "bg-gray-800 hover:bg-gray-700 text-gray-300"
                  } transition-all duration-200 hover:scale-105">
                    ${this.config.translations.declineButtonText}
                  </button>
                  
                  <!-- Desktop buttons -->
                  <div class="hidden md:flex items-center gap-3">
                    <button class="decline-all flex-1 px-3 py-1.5 text-xs font-medium rounded-md ${
                      isLight
                        ? "bg-gray-200 hover:bg-gray-300 text-gray-800"
                        : "bg-gray-800 hover:bg-gray-700 text-gray-300"
                    } transition-all duration-200 hover:scale-105">
                      ${this.config.translations.declineButtonText}
                    </button>
                    <button class="accept-all flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-all duration-200 hover:scale-105">
                      ${this.config.translations.buttonText}
                    </button>
                  </div>
                  
                  <!-- Customize button -->
                  <button class="customize w-full px-4 py-2.5 md:px-3 md:py-1.5 text-sm md:text-xs font-medium rounded-md border border-blue-500 text-blue-500 bg-transparent hover:text-blue-600 hover:border-blue-600 transition-all duration-200 hover:scale-105">
                    ${this.config.translations.manageButtonText}
                  </button>
                </div>
                `
                : `
                <div class="flex flex-col md:flex-row md:items-center md:justify-between w-full gap-3">
                  <div class="flex flex-col md:flex-row md:items-center gap-3">
                    <button class="customize w-full md:w-auto px-4 py-2.5 md:px-3 md:py-1.5 text-sm md:text-xs font-medium rounded-md border border-blue-500 text-blue-500 bg-transparent hover:text-blue-600 hover:border-blue-600 transition-all duration-200 hover:scale-105">
                      ${this.config.translations.manageButtonText}
                    </button>
                    <button class="decline-all w-full md:w-auto px-4 py-2.5 md:px-3 md:py-1.5 text-sm md:text-xs font-medium rounded-md ${
                      isLight
                        ? "bg-gray-200 hover:bg-gray-300 text-gray-800"
                        : "bg-gray-800 hover:bg-gray-700 text-gray-300"
                    } transition-all duration-200 hover:scale-105">
                      ${this.config.translations.declineButtonText}
                    </button>
                    <button class="accept-all w-full md:w-auto px-4 py-2.5 md:px-3 md:py-1.5 text-sm md:text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-all duration-200 hover:scale-105">
                      ${this.config.translations.buttonText}
                    </button>
                  </div>
                </div>
                `
            }
          </div>
        </div>
      `;

      // Add event listeners to all buttons with these classes
      banner.querySelectorAll(".accept-all").forEach((button) => {
        button.addEventListener("click", () => {
          this.saveConsent(this.config.categories);
        });
      });

      banner.querySelectorAll(".decline-all").forEach((button) => {
        button.addEventListener("click", () => {
          this.saveConsent({
            analytics: false,
            marketing: false,
            preferences: false,
          });
        });
      });

      banner.querySelectorAll(".customize").forEach((button) => {
        button.addEventListener("click", () => {
          this.showCustomizeModal();
        });
      });

      wrapper.appendChild(banner);
      document.body.appendChild(wrapper);
      this.banner = banner;
      this.wrapper = wrapper;

      // Create the customize modal right after creating the banner
      this.createCustomizeModal();
    }

    createCustomizeModal() {
      const modalWrapper = document.createElement("div");
      modalWrapper.className = "cookie-manager transition-opacity duration-300";

      const isLight = this.config.theme === "light";

      const modal = document.createElement("div");
      modal.className =
        "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-lg z-[10000] hidden";
      modal.innerHTML = `
        <div class="rounded-xl p-6 ${
          isLight
            ? "bg-white/95 ring-2 ring-gray-200"
            : "bg-black/95 ring-1 ring-white/10"
        }">
          <div class="flex flex-col gap-6">
            <div>
              <h3 class="text-sm font-semibold mb-2 ${
                isLight ? "text-gray-900" : "text-white"
              }">${this.config.translations.manageTitle}</h3>
              <p class="text-xs ${
                isLight ? "text-gray-700" : "text-gray-200"
              }">${this.config.translations.manageMessage}</p>
            </div>

            <div class="flex flex-col gap-4">
              <!-- Essential Cookies -->
              <div class="flex items-start justify-between">
                <div>
                  <h4 class="text-xs font-medium text-left ${
                    isLight ? "text-gray-900" : "text-white"
                  }">Essential</h4>
                  <p class="text-xs text-left ${
                    isLight ? "text-gray-600" : "text-gray-400"
                  }">Required for the website to function properly.</p>
                  <p class="text-xs mt-1 text-left text-gray-500">Always enabled</p>
                </div>
                <div class="px-3 py-1 text-xs text-center font-medium rounded-full ${
                  isLight
                    ? "bg-gray-200 text-gray-600"
                    : "bg-gray-800 text-gray-300"
                }">
                  Required
                </div>
              </div>

              <!-- Analytics Cookies -->
              <div class="flex items-start justify-between">
                <div>
                  <h4 class="text-xs font-medium text-left ${
                    isLight ? "text-gray-900" : "text-white"
                  }">Analytics</h4>
                  <p class="text-xs text-left ${
                    isLight ? "text-gray-600" : "text-gray-400"
                  }">Help us understand how visitors interact with our website.</p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" name="analytics" class="sr-only peer">
                  <div class="w-11 h-6 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-500 
                    ${
                      isLight
                        ? "bg-gray-200 peer-checked:bg-blue-500"
                        : "bg-gray-700 peer-checked:bg-blue-500"
                    } 
                    peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 
                    after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 
                    after:transition-all">
                  </div>
                </label>
              </div>

              <!-- Marketing Cookies -->
              <div class="flex items-start justify-between">
                <div>
                  <h4 class="text-xs font-medium text-left ${
                    isLight ? "text-gray-900" : "text-white"
                  }">Marketing</h4>
                  <p class="text-xs text-left ${
                    isLight ? "text-gray-600" : "text-gray-400"
                  }">Allow us to personalize your experience and send you relevant content.</p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" name="marketing" class="sr-only peer">
                  <div class="w-11 h-6 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-500 
                    ${
                      isLight
                        ? "bg-gray-200 peer-checked:bg-blue-500"
                        : "bg-gray-700 peer-checked:bg-blue-500"
                    } 
                    peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 
                    after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 
                    after:transition-all">
                  </div>
                </label>
              </div>

              <!-- Preferences Cookies -->
              <div class="flex items-start justify-between">
                <div>
                  <h4 class="text-xs font-medium text-left ${
                    isLight ? "text-gray-900" : "text-white"
                  }">Preferences</h4>
                  <p class="text-xs text-left ${
                    isLight ? "text-gray-600" : "text-gray-400"
                  }">Remember your settings and provide enhanced functionality.</p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" name="preferences" class="sr-only peer">
                  <div class="w-11 h-6 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-500 
                    ${
                      isLight
                        ? "bg-gray-200 peer-checked:bg-blue-500"
                        : "bg-gray-700 peer-checked:bg-blue-500"
                    } 
                    peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 
                    after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 
                    after:transition-all">
                  </div>
                </label>
              </div>
            </div>

            <div class="flex justify-end gap-3">
              <button class="cancel px-3 py-1.5 text-xs font-medium rounded-md border border-gray-500 text-gray-500 bg-transparent hover:text-gray-600 hover:border-gray-600 transition-all duration-200 hover:scale-105">
                ${this.config.translations.cancel}
              </button>
              <button class="save-preferences px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-all duration-200 hover:scale-105">
                ${this.config.translations.savePreferences}
              </button>
            </div>
          </div>
        </div>
      `;

      const overlay = document.createElement("div");
      overlay.className = `fixed inset-0 ${
        this.config.style === "modal"
          ? "bg-black/20 backdrop-blur-[2px]"
          : "bg-black/40"
      } z-[9999] hidden transition-all duration-300`;

      modal.querySelector(".save-preferences").addEventListener("click", () => {
        const categories = {
          analytics: modal.querySelector('input[name="analytics"]').checked,
          marketing: modal.querySelector('input[name="marketing"]').checked,
          preferences: modal.querySelector('input[name="preferences"]').checked,
        };
        this.saveConsent(categories);
      });

      modal.querySelector(".cancel").addEventListener("click", () => {
        this.hideCustomizeModal();
      });

      // Set initial state if exists
      if (this.state) {
        modal.querySelector('input[name="analytics"]').checked =
          this.state.analytics;
        modal.querySelector('input[name="marketing"]').checked =
          this.state.marketing;
        modal.querySelector('input[name="preferences"]').checked =
          this.state.preferences;
      }

      modalWrapper.appendChild(overlay);
      modalWrapper.appendChild(modal);
      document.body.appendChild(modalWrapper);
      this.modal = modal;
      this.overlay = overlay;
      this.modalWrapper = modalWrapper;
    }

    showCustomizeModal() {
      // Create modal if it doesn't exist
      if (!this.modal) {
        this.createCustomizeModal();
      }
      this.modal.classList.remove("hidden");
      this.overlay.classList.remove("hidden");

      // If we're in modal style, make sure the body doesn't scroll
      if (this.config.style === "modal") {
        document.body.style.overflow = "hidden";
      }
    }

    hideCustomizeModal() {
      if (this.modal) {
        this.modal.classList.add("hidden");
        this.overlay.classList.add("hidden");

        // Restore body scrolling
        document.body.style.overflow = "";
      }
    }

    init(config = {}) {
      // Merge config with defaults
      this.config = {
        ...this.config,
        ...config,
      };

      // Create UI elements if no consent exists
      const consent = this.loadConsent();

      if (!consent) {
        this.createBanner();
      }

      // Initialize blocking
      this.initializeBlocking();
    }

    // Function to check if URL should be blocked
    shouldBlockRequest(url) {
      const urlString = url.toString();

      // Check if domain is in allowed domains - these are never blocked
      if (this.config.allowedDomains?.length > 0) {
        if (
          this.config.allowedDomains.some((domain) =>
            urlString.includes(domain)
          )
        ) {
          return false;
        }
      }

      // Get consent state
      const consent = this.loadConsent();

      // If no consent exists, block everything except allowed domains
      if (!consent) {
        return true;
      }

      // Check analytics
      if (
        !consent.analytics &&
        (urlString.includes("google-analytics") ||
          urlString.includes("analytics.google.com"))
      ) {
        return true;
      }

      // Check marketing
      if (
        !consent.marketing &&
        (urlString.includes("twitter") ||
          urlString.includes("doubleclick") ||
          urlString.includes("facebook") ||
          urlString.includes("linkedin"))
      ) {
        return true;
      }

      return false;
    }
  }

  // Expose to global scope
  window.CookieKit = {
    manager: null,
    init: (config) => {
      window.CookieKit.manager = new CookieManager(config);
      window.CookieKit.manager.init(config);
    },
    showBanner: () => {
      if (window.CookieKit.manager) {
        window.CookieKit.manager.createBanner();
        window.CookieKit.manager.createCustomizeModal();
      }
    },
    showCustomizeModal: () => {
      if (window.CookieKit.manager) {
        window.CookieKit.manager.showCustomizeModal();
      }
    },
    resetConsent: () => {
      document.cookie =
        "cookie_consent=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

      // Instead of reloading the page, just show the banner again
      if (window.CookieKit.manager) {
        // Clear the state
        window.CookieKit.manager.state = null;

        // Remove existing banner and modal if they exist
        if (window.CookieKit.manager.wrapper) {
          document.body.removeChild(window.CookieKit.manager.wrapper);
          window.CookieKit.manager.wrapper = null;
          window.CookieKit.manager.banner = null;
        }

        if (window.CookieKit.manager.modalWrapper) {
          document.body.removeChild(window.CookieKit.manager.modalWrapper);
          window.CookieKit.manager.modalWrapper = null;
          window.CookieKit.manager.modal = null;
          window.CookieKit.manager.overlay = null;
        }

        // Show the banner again
        window.CookieKit.showBanner();

        // Reinitialize blocking
        window.CookieKit.manager.initializeBlocking();

        // Trigger the consent updated event
        window.dispatchEvent(
          new CustomEvent("cookiekit:consent-updated", {
            detail: null,
          })
        );
      }
    },
  };
})();
