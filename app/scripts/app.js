const state = {
  client: null,
  entity: null,
  productboardNotes: null,
  syncTags: null
};


document.onreadystatechange = function () {
  if (document.readyState === "complete") {
    renderApp();
  }

  function renderApp() {
    init();
  }
};

async function init() {
  try {
    state.client = await app.initialized();
    const tagDecision = await state.client.iparams.get('sync_tags');
    state.syncTags = tagDecision.sync_tags;
    state.entity = state.client.db.entity({ version: "v1" });
    state.productboardNotes = state.entity.get("productboardNoteEntity");
    state.client.events.on('app.activated', renderNotes());
  } catch (error) {
    console.error('Error initializing:', error);
  }
}
async function renderNotes() {
  try {
    const ticket = await state.client.data.get('ticket');
    const currentProductboardNotes = await state.productboardNotes.getAll({
      query: {
        ticket_id: ticket.ticket.id
      }
    });
    const sendButton = document.getElementById('sendButton');
    const userInput = document.getElementById('userInput');
    sendButton.innerText = currentProductboardNotes.records.length === 0
      ? "Push to Productboard"
      : "Push again to Productboard";

    if (currentProductboardNotes.records.length > 0) {
      userInput.placeholder = "(Optional) Include another summary of the customer feedback or just resend the ticket to Productboard. This will create a new note.";
    }

    const currentProductboardNotesData = currentProductboardNotes.records;
    if (currentProductboardNotesData.length > 0) {
      const historyHeader = document.getElementById('historyHeader');
      historyHeader.innerHTML = `<fw-icon name="info" slot="icon"></fw-icon>History`
      historyHeader.setAttribute('color', 'green')
    }

    const history = document.getElementById('sectionContainer');
    history.innerHTML = '';
    let height = 226;
    for (let i = 0; i < currentProductboardNotesData.length; i++) {
      const productboardNoteUrl = currentProductboardNotesData[i].data.URL;
      const inlineMessage = document.createElement('fw-inline-message');
      inlineMessage.setAttribute('open', '');
      inlineMessage.setAttribute('type', 'success');
      inlineMessage.setAttribute('closable', 'false');
      inlineMessage.setAttribute('fw-type-sm', '')
      const timestamp = formatTimestamp(currentProductboardNotesData[i].created_time);

      if (i === currentProductboardNotesData.length - 1) {
        inlineMessage.textContent = `Ticket pushed on ${timestamp}. Click here to open.`;
      } else {
        inlineMessage.textContent = `Ticket pushed again on ${timestamp}. Click here to open.`;
      }
      inlineMessage.onclick = function () {
        window.open(productboardNoteUrl, '_blank');
      };
      history.appendChild(inlineMessage);
      height += 85;
    }
    state.client.instance.resize({ height: height + "px" });
    document.getElementById('errorDisplay').style.display = 'none';
    return currentProductboardNotes;
  } catch (error) {
    console.log('Error rendering notes: ', error);
  }
}


async function getTicketConversation(ticketId, pageNumber) {
  try {
    const ticketConversation = await state.client.request.invokeTemplate("getTicketConversation", {
      context: {
        query: ticketId,
        page: pageNumber
      },
      cache: false
    });
    return ticketConversation;
  } catch (error) {
    console.log('Error getting ticket conversation: ', error.status);
    throw error;
  }
}


async function getAllTicketConversations(ticketId) {
  let allConversations = [];
  let pageNumber = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    try {
      const ticketConversation = await getTicketConversation(ticketId, pageNumber);
      const conversationPage = JSON.parse(ticketConversation.response);
      allConversations = allConversations.concat(conversationPage);
      if (conversationPage.length < 30) {
        hasMorePages = false;
      } else {
        pageNumber++;
      }
    } catch (error) {
      console.log('Error getting ticket conversation!:', error);
      hasMorePages = false;
      throw error
    }
  }

  return allConversations;
}


async function sendProductboardNote(noteContent) {
  try {
    const { ticket, loggedInUser, domainName } = await fetchData();
    const allConversations = await getConversations(ticket.ticket.id);
    const parsedTicketConversation = handleConversationErrors(allConversations);

    let noteBody = buildNoteBody(ticket, domainName, loggedInUser, noteContent, parsedTicketConversation);
    noteBody = handleSizeLimit(noteBody, noteContent, loggedInUser);
    if (!noteBody) return displaySizeError();

    return await createProductboardNote(noteBody);
  } catch (error) {
    handleError(error);
  }
}

async function fetchData() {
  const ticket = await state.client.data.get('ticket');
  const loggedInUser = await state.client.data.get('loggedInUser');
  const domainName = await state.client.data.get('domainName');
  return { ticket, loggedInUser, domainName };
}

async function getConversations(ticketId) {
  try {
    return await getAllTicketConversations(ticketId);
  } catch (error) {
    console.log('Error getting ticket conversation:', error);
    throw error;
  }
}


function handleConversationErrors(allConversations) {
  if (allConversations.includes("Error 404")) {
    return '';
  }
  return extractAndFormatBody(allConversations);
}

function buildNoteBody(ticket, domainName, loggedInUser, noteContent, parsedTicketConversation) {
  const tags = state.syncTags === "Yes"
    ? [{ name: 'Freshdesk' }].concat(ticket.ticket.tags.map(t => ({ name: t })))
    : [];

  return {
    data: {
      type: "textNote",
      fields: {
        name: `Freshdesk Ticket: ${ticket.ticket.subject}`,
        content: `${noteContent === "<p></p>" ? '' : `<h2>Summary:</h2>${noteContent}<br>`}
             <h2>Ticket Content:</h2>${ticket.ticket.description}<hr/>
             ${parsedTicketConversation}
             <h2>Submitted from Freshdesk by:</h2>
             <b>${loggedInUser.loggedInUser.contact.email}</b>`,
        tags: tags
      },
      metadata: {
        source: {
          system: "freshdesk",
          url: `https://${domainName.domainName}/a/tickets/${ticket.ticket.id}`
        }
      },
      relationships: [
        {
          type: "customer",
          target: { email: ticket.ticket.sender_email, type: "user" }
        }
      ]
    }
  };
}

function handleSizeLimit(noteBody, noteContent, loggedInUser) {
  const noteBodyString = JSON.stringify(noteBody);
  const noteBodySize = new Blob([noteBodyString]).size;
  if (noteBodySize >= 102400) {
    if (!noteContent || noteContent === "<p></p>") {
      return null;
    }

    noteBody.data.fields.content = `<i>The ticket conversation was removed due to size. A summary is provided below.</i><br/>
                        <h2>Summary:</h2><p>${noteContent}</p>
                        <h2>Submitted from Freshdesk by:</h2>
                        <b>${loggedInUser.loggedInUser.contact.email}</b>`;

    return noteBody;
  }

  return noteBody;
}

function getMissingResources(errorBody, noteBody) {
  const result = { customer: null, tags: [] };
  if (!errorBody.errors) return result;

  const missingCustomer = errorBody.errors.find(
    e => e.code === 'resource.notFound' && e.detail && e.detail.includes('Customer')
  );
  if (missingCustomer && noteBody.data.relationships) {
    const customerRel = noteBody.data.relationships.find(r => r.type === 'customer');
    if (customerRel && customerRel.target.email) {
      result.customer = customerRel.target.email;
    }
  }

  const missingTags = errorBody.errors.filter(
    e => e.code === 'selectOption.notFound' && e.detail && e.detail.includes('tags')
  );
  result.tags = missingTags.map(e => {
    const match = e.detail.match(/label '([^']+)'/);
    return match ? match[1] : null;
  }).filter(Boolean);

  return result;
}

function extractAndFormatBody(payload) {
  return payload.reduce((acc, message, index) => {
    const privateMessage = message.private;
    const source = message.source;
    const replyNumber = index + 1;
    let replyHeader;
    const fromEmail = message.from_email;
    if (privateMessage && source === 2) {
      replyHeader = `<b>#${replyNumber}: Internal note`
    } else if (!privateMessage && source === 2) {
      replyHeader = `<b>#${replyNumber}: External note`
    } else {
      replyHeader = `<b>#${replyNumber}: Reply from ${fromEmail}`
    }
    const timestamp = formatTimestamp(message.created_at);
    const formattedBody = `${replyHeader} on ${timestamp}</b>:${message.body}<hr/>`;
    return acc + formattedBody;
  }, '');
}

function formatTimestamp(timestamp) {
  const months = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const date = new Date(timestamp);
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 === 0 ? 12 : hours % 12;
  const formattedMinutes = minutes < 10 ? '0' + minutes : minutes;
  return `${month} ${day}, ${year} ${formattedHours}:${formattedMinutes} ${meridiem}`;
}

async function createMissingResources(missing) {
  const tasks = [];
  if (missing.customer) {
    tasks.push(createProductboardUser(missing.customer));
  }
  if (missing.tags.length > 0) {
    missing.tags.forEach(name => tasks.push(createProductboardTag(name)));
  }
  await Promise.all(tasks);
}

function filterMissingResources(missing, created) {
  if (created.customer) missing.customer = null;
  missing.tags = missing.tags.filter(t => !created.tags.has(t));
  return missing;
}

async function handleNoteRetry(error, noteBody, created, attempt, maxRetries) {
  console.error(`Productboard API error (attempt ${attempt}):`, error.status);
  const errorBody = JSON.parse(error.response || '{}');
  const missing = filterMissingResources(getMissingResources(errorBody, noteBody), created);

  if ((!missing.customer && missing.tags.length === 0) || attempt === maxRetries) throw error;

  await createMissingResources(missing);
  if (missing.customer) created.customer = true;
  missing.tags.forEach(t => created.tags.add(t));
  await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
}

async function createProductboardNote(noteBody) {
  const maxRetries = 5;
  const created = { customer: false, tags: new Set() };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await state.client.request.invokeTemplate("createProductboardNote", {
        context: {},
        body: JSON.stringify(noteBody)
      });
    } catch (error) {
      await handleNoteRetry(error, noteBody, created, attempt, maxRetries);
    }
  }
}

async function createProductboardUser(email) {
  const response = await state.client.request.invokeTemplate("createProductboardUser", {
    context: {},
    body: JSON.stringify({ data: { type: "user", fields: { email: email } } })
  });
  return response;
}

async function createProductboardTag(name) {
  const response = await state.client.request.invokeTemplate("createProductboardTag", {
    context: {},
    body: JSON.stringify({ data: { fields: { name: name } } })
  });
  return response;
}

function handleError(error) {
  if (error.status === 401 || error.status === 400) {
    displayAuthError();
  } else {
    document.getElementById('errorDisplay').textContent = `Error ${error.status || "Unknown"}: ${error.message}`;
    document.getElementById('errorDisplay').style.display = 'block';
  }
  document.getElementById('sendButton').loading = false;
}

function displayAuthError() {
  document.getElementById('errorDisplay').textContent = 'Error sending ticket to Productboard. Make sure your Freshdesk and Productboard API tokens are valid.';
  document.getElementById('errorDisplay').style.display = 'block';
  document.querySelector('fw-textarea').value = '';
  document.getElementById('sendButton').loading = false;
}

function displaySizeError() {
  document.getElementById('errorDisplay').textContent = 'Error: Summary is required because the ticket content is too large to send to Productboard and has been removed.';
  document.getElementById('errorDisplay').style.display = 'block';
  document.getElementById('sendButton').loading = false;
}

document.getElementById('sendButton').addEventListener('click', async function () {
  const ticket = await state.client.data.get('ticket');
    const userInput = document.getElementById('userInput').value;
    document.getElementById('sendButton').loading = true;
    try {
      const response = await sendProductboardNote(`<p>${userInput}</p>`)
      if (!response) return;
      const parsedResponse = JSON.parse(response.response);
      const productboardNoteLink = parsedResponse.data.links.html;
      await state.productboardNotes.create({
        URL: productboardNoteLink,
        ticket_id: ticket.ticket.id
      });

      await renderNotes();
      document.querySelector('fw-textarea').value = ''
      document.getElementById('sendButton').loading = false;
    } catch (e) {
      console.error('Error in send flow:', e);
      return
    }
});

