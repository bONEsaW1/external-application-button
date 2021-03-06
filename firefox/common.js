/* globals Parser, browser */
'use strict';

const application = 'com.add0n.node';

if (typeof browser === 'object') {
  chrome.contextMenus = browser.menus;
}

const log = (...args) => false && console.log(...args);

const notify = e => chrome.notifications.create({
  type: 'basic',
  iconUrl: '/data/icons/48.png',
  title: chrome.runtime.getManifest().name,
  message: e.message || e
});

function error(response) {
  window.alert(`Something went wrong!

-----
Code: ${response.code}
Output: ${response.stdout}
Error: ${response.stderr}`);
}

function response(res, tabId, frameId, post) {
  // windows batch returns 1
  if (res && (res.code !== 0 && (res.code !== 1 || res.stderr !== ''))) {
    error(res);
  }
  else if (!res) {
    chrome.tabs.create({
      url: '/data/helper/index.html'
    });
  }
  else if (post) {
    const code = post.replace(/\[POST_SCRIPT_CODE\]/g, res.code)
      .replace(/\[POST_SCRIPT_STDOUT\]/g, res.stdout)
      .replace(/\[POST_SCRIPT_STDERR\]/g, res.stderr);
    chrome.tabs.executeScript(tabId, {
      code,
      runAt: 'document_start',
      frameId
    }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        console.warn(lastError);
        notify(lastError);
      }
    });
  }
}

function download(url) {
  if (/google\.[^./]+\/url?/.test(url)) {
    const tmp = /url=([^&]+)/.exec(url);
    if (tmp && tmp.length) {
      url = decodeURIComponent(tmp[1]);
    }
  }
  return new Promise((resolve, reject) => {
    chrome.downloads.download({url}, id => {
      function observe(d) {
        if (d.id === id && d.state) {
          if (d.state.current === 'complete' || d.state.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(observe);
            if (d.state.current === 'complete') {
              chrome.downloads.search({id}, ([d]) => {
                if (d) {
                  resolve(d);
                }
                else {
                  reject(Error('I am not able to find the downloaded file!'));
                }
              });
            }
            else {
              reject(Error('The downloading job got interrupted'));
            }
          }
        }
      }
      chrome.downloads.onChanged.addListener(observe);
    });
  });
}

function update() {
  chrome.storage.local.get({
    apps: {},
    active: null
  }, prefs => {
    if (prefs.active) {
      const app = prefs.apps[prefs.active];
      chrome.browserAction.setIcon({
        path: app.icon
      });
      chrome.browserAction.setTitle({
        title: app.name
      });
    }
    else {
      chrome.browserAction.setIcon({
        path: {
          '16': 'data/icons/16.png',
          '32': 'data/icons/32.png',
          '64': 'data/icons/64.png'
        }
      });
      chrome.browserAction.setTitle({
        title: 'External Application Button'
      });
    }
    chrome.contextMenus.removeAll(() => {
      Object.keys(prefs.apps).filter(k => {
        const context = prefs.apps[k].context;
        if (!context) {
          return false;
        }
        if (typeof context === 'string') {
          return context;
        }
        else {
          return context.length;
        }
      }).forEach(id => {
        let pattern = ['*://*/*', 'file://*/*'];
        if (prefs.apps[id].pattern) {
          const tmp = prefs.apps[id].pattern;
          pattern = tmp.split(/\s*,\s*/);
        }
        let contexts = prefs.apps[id].context;
        if (typeof contexts === 'string') {
          contexts = [contexts];
        }
        const pageContexts = contexts.filter(s => ['page', 'tab', 'selection', 'editable', 'password', 'bookmark']
          .indexOf(s) !== -1);
        const linkContexts = contexts.filter(s => ['page', 'tab', 'selection', 'editable', 'password', 'bookmark']
          .indexOf(s) === -1);

        function add(obj) {
          log(obj);
          chrome.contextMenus.create(obj, () => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              console.warn(lastError);
              notify(lastError);
            }
          });
        }

        const documentUrlPatterns = prefs.apps[id].filters.split(/\s*,\s*/).filter(a => a);

        if (pageContexts.length) {
          add({
            id: id + '-page',
            title: prefs.apps[id].name,
            contexts: pageContexts,
            documentUrlPatterns: documentUrlPatterns.length ? documentUrlPatterns : pattern
          });
        }
        if (linkContexts.length) {
          const o = {
            id: id + '-link',
            title: prefs.apps[id].name,
            contexts: linkContexts,
            targetUrlPatterns: pattern
          };
          if (documentUrlPatterns.length) {
            o.documentUrlPatterns = documentUrlPatterns;
          }
          try {
            add(o);
          }
          catch (e) {
            console.error(e, o);
            notify(`Cannot create context entry for "${prefs.apps[id].name}"


--
${e.message}`);
          }
        }
      });
      const bi = Object.keys(prefs.apps).filter(k => prefs.apps[k].toolbar);
      bi.forEach((id, index) => {
        chrome.contextMenus.create({
          id: 'change-to-' + id,
          title: prefs.apps[id].name,
          contexts: ['browser_action'],
          parentId: (index > 4 && bi.length > 6) ? 'extra' : undefined
        });
        if (index === 4 && bi.length > 6) {
          chrome.contextMenus.create({
            title: 'Extra Applications',
            id: 'extra',
            contexts: ['browser_action']
          });
        }
      });
    });
  });
}

async function argv(app, url, selectionText, tabId, pre) {
  let downloadedPath = '';
  let userAgent = app.userAgent || '';
  let referrer = app.referrer || '';
  let cookie = app.cookie || '';

  if (tabId && app.args.indexOf('[USERAGENT]') !== -1 && !userAgent) {
    await new Promise(resolve => chrome.tabs.executeScript(tabId, {
      runAt: 'document_start',
      code: 'navigator.userAgent'
    }, arr => {
      if (arr && arr[0]) {
        userAgent = arr[0];
      }
      resolve();
    }));
  }
  if (tabId && app.args.indexOf('[REFERRER]') !== -1 && !referrer) {
    await new Promise(resolve => chrome.tabs.executeScript(tabId, {
      runAt: 'document_start',
      code: 'document.referrer'
    }, arr => {
      if (arr && arr[0]) {
        referrer = arr[0];
      }
      resolve();
    }));
  }
  if (tabId && app.args.indexOf('[COOKIE]') !== -1 && !cookie) {
    await new Promise(resolve => chrome.tabs.executeScript(tabId, {
      runAt: 'document_start',
      code: 'document.cookie'
    }, arr => {
      if (arr && arr[0]) {
        cookie = arr[0];
      }
      resolve();
    }));
  }

  try {
    url = new URL(url);
  }
  catch (e) {
    url = {
      href: url
    };
  }

  function step() {
    const termref = {
      lineBuffer: app.args.replace(/\[HREF\]/g, url.href)
        .replace(/\[HOSTNAME\]/g, url.hostname)
        .replace(/\[PATHNAME\]/g, url.pathname)
        .replace(/\[HASH\]/g, url.hash)
        .replace(/\[PROTOCOL\]/g, url.protocol)
        .replace(/\[SELECTIONTEXT\]/g, selectionText)
        .replace(/\[DOWNLOADED_PATH\]/g, downloadedPath)
        .replace(/\[FILENAME\]/g, app.filename)
        .replace(/\[REFERRER\]/g, referrer)
        .replace(/\[USERAGENT\]/g, userAgent)
        .replace(/\[COOKIE\]/g, cookie)
        .replace(/\[PRE_SCRIPT\]/g, pre)
        .replace(/\[PROMPT\]/g, () => window.prompt('User Input'))
        .replace(/\\/g, '\\\\')
    };
    const parser = new Parser();
    // fixes https://github.com/andy-portmen/external-application-button/issues/5
    parser.escapeExpressions = {};
    parser.parseLine(termref);

    if (app.quotes) {
      termref.argv = termref.argv.map((a, i) => {
        if (termref.argQL[i]) {
          return termref.argQL[i] + a + termref.argQL[i];
        }
        return a;
      });
    }
    return termref.argv;
  }

  if (app.args.indexOf('[DOWNLOADED_PATH]') === -1) {
    return Promise.resolve(step());
  }
  else {
    return download(url.href).then(d => {
      downloadedPath = d.filename;
      return step();
    }).catch(e => notify(e));
  }
}

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'parse') {
    argv(request.app, 'http://example.com/index.html', 'Sample selected text', 0, 'PRE_SCIPT_OUTPUT').then(response).catch(e => notify(e));
    return true;
  }
  else if (request.method === 'notify') {
    notify(request.message);
  }
});

function execute(app, tab, selectionText, frameId) {
  const next = pre => argv(app, tab.url, selectionText, tab.id, pre)
    .then(args => chrome.runtime.sendNativeMessage(application, {
      cmd: 'exec',
      command: app.path,
      arguments: args,
      properties: app.quotes ? {windowsVerbatimArguments: true} : {}
    }, r => {
      if (app.closeme && tab.id) {
        chrome.tabs.remove(tab.id);
      }
      if (app.changestate && tab.windowId) {
        chrome.windows.update(tab.windowId, {
          state: app.changestate
        });
      }
      if (!app.errors) {
        response(r, tab.id, frameId, app.post);
      }
    })).catch(e => notify(e));
  if (app.pre) {
    chrome.tabs.executeScript(tab.id, {
      frameId,
      code: app.pre
    }, arr => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        console.warn(lastError);
        notify(lastError);
      }
      else if (arr.length) {
        next(arr[0]);
      }
      else {
        next();
      }
    });
  }
  else {
    next();
  }
}
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((request, sender, response) => {
    chrome.storage.local.get({
      external_allowed: [],
      external_denied: []
    }, prefs => {
      if (prefs.external_denied.indexOf(sender.id) !== -1) {
        return response(false);
      }
      if (prefs.external_allowed.indexOf(sender.id) === -1) {
        if (window.confirm(`An external application with ID "${sender.id}" requested a new connection.

  Should I allow this application to execute OS level commands?`)) {
          chrome.storage.local.set({
            external_allowed: [...prefs.external_allowed, sender.id]
          });
        }
        else {
          chrome.storage.local.set({
            external_denied: [...prefs.external_denied, sender.id]
          });
          return response(false);
        }
      }
      execute(request.app, request.tab, request.selectionText, frameId);
      response(true);
    });
    return true;
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.bookmarkId) {
    const node = await new Promise(resolve => chrome.bookmarks.get(info.bookmarkId, ([node]) => resolve(node)));
    tab = {
      url: node.url
    };
  }
  const id = info.menuItemId;
  if (id.startsWith('change-to-')) {
    chrome.storage.local.set({
      active: id.replace('change-to-', '')
    });
  }
  else {
    chrome.storage.local.get({
      apps: {}
    }, prefs => {
      const app = prefs.apps[id.replace('-page', '').replace('-link', '')];
      const selectionText = info.selectionText;
      let url = info.pageUrl;
      if (typeof app.context === 'string') {
        app.context = [app.context];
      }
      if (id.endsWith('-page')) {
        url = info.pageUrl || info.frameUrl || tab.url;
      }
      else { // ends with -link
        if (info.mediaType && app.context.indexOf('link') === -1) {
          url = info.srcUrl || info.linkUrl || info.frameUrl || info.pageUrl;
        }
        else {
          url = info.linkUrl || info.frameUrl || info.pageUrl;
        }
      }
      execute(app, {
        url,
        id: tab.id,
        windowId: tab.windowId
      }, selectionText, info.frameId);
    });
  }
});

{
  let called = false;
  const callback = () => {
    if (called === false) {
      called = true;
      update();
    }
  };
  chrome.runtime.onInstalled.addListener(callback);
  chrome.runtime.onStartup.addListener(callback);
}

chrome.storage.onChanged.addListener(prefs => {
  if (prefs.active || prefs.apps) {
    update();
  }
});

chrome.browserAction.onClicked.addListener(tab => {
  chrome.storage.local.get({
    active: null,
    apps: {}
  }, prefs => {
    if (prefs.active) {
      execute(prefs.apps[prefs.active], tab, '', 0);
    }
    else {
      chrome.runtime.openOptionsPage();
    }
  });
});

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const page = getManifest().homepage_url;
    const {name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install'
            });
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
