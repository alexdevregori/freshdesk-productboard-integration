let client;
let entity;
let productboardNotes;
let isInitialized = false; // Flag to track initialization status
let syncTags;

init();

async function init() {
  try {
    client = await app.initialized();
    syncTags = await client.iparams.get('sync_tags');
    syncTags = syncTags.sync_tags
    entity = client.db.entity({ version: "v1" });
    productboardNotes = entity.get("productboardNoteEntity");

    renderNotes()
    isInitialized = true; // Set flag to true after initialization completes
    if (isInitialized === true) {
      console.log('App iniitalized!')
    }
  } catch (error) {
    console.error('Error initializing:', error);
  }
}

async function renderNotes() {
  try {
    const ticket = await client.data.get('ticket');

    const currentProductboardNotes = await productboardNotes.getAll({
      query: {
        ticket_id: ticket.ticket.id
      }
    });
    const currentProductboardNotesData = currentProductboardNotes.records;
    if(currentProductboardNotesData.length > 0) {
      const historyHeader = document.getElementById('historyHeader');
      historyHeader.innerHTML = `<fw-icon name="info" slot="icon"></fw-icon>History` 
      historyHeader.setAttribute('color', 'green')
    }
    
    const history = document.getElementById('sectionContainer');
    history.innerHTML = '';
    let height = 225;
    for (let i = 0; i < currentProductboardNotesData.length; i++) {
      const productboardNoteUrl = currentProductboardNotesData[i].data.URL;
      const inlineMessage = document.createElement('fw-inline-message');
      inlineMessage.setAttribute('open', '');
      inlineMessage.setAttribute('type', 'success');
      inlineMessage.setAttribute('closable', 'false');
      inlineMessage.setAttribute('fw-type-sm', '')
      let timestamp = formatTimestamp(currentProductboardNotesData[i].created_time);

      inlineMessage.textContent = `Ticket pushed on ${timestamp}. Click here to open.`;
      inlineMessage.onclick = function () {
        window.open(productboardNoteUrl, '_blank');
      };
      history.appendChild(inlineMessage);


      height += 85;
    }
    client.instance.resize({ height: height + "px" });

    document.getElementById('errorDisplay').style.display = 'none';
    return currentProductboardNotes;
  } catch (error) {
    console.log('Error rendering notes: ', error);    
  }
}

async function getTicketConversation(ticketId, pageNumber) {
  try {
    let ticketConversation = await client.request.invokeTemplate("getTicketConversation", {
      context: {
        query: ticketId,
        page: pageNumber
      },
      cache: false
    });
    return ticketConversation;
  } catch (error) {
    console.log('Error getting ticket conversation: ', error)
    if (error.status === 401) {
      document.getElementById('errorDisplay').textContent = 'Error 401. Make sure your Freshdesk API key is valid.';
      document.getElementById('errorDisplay').style.display = 'block';
    }
    if (error.status === 404) {
      document.getElementById('errorDisplay').textContent = 'Error 404. Make sure your Freshdesk API key and subdomain were entered correctly during installation.';
      document.getElementById('errorDisplay').style.display = 'block';
    }
  }
}

async function getAllTicketConversations(ticketId) {
  let allConversations = [];
  let pageNumber = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const ticketConversation = await getTicketConversation(ticketId, pageNumber);
    if (ticketConversation && ticketConversation.response) {
      const conversationPage = JSON.parse(ticketConversation.response);
      allConversations = allConversations.concat(conversationPage);

      if (conversationPage.length < 30) {
        hasMorePages = false;
      } else {
        pageNumber++;
      }
    } else {
      hasMorePages = false;
    }
  }
  return allConversations;
}

async function sendProductboardNote(noteContent) {
  const ticket = await client.data.get('ticket');
  const loggedInUser = await client.data.get('loggedInUser')
  const domainName = await client.data.get('domainName')
  try {
    const allConversations = await getAllTicketConversations(ticket.ticket.id);
    const parsedTicketConversation = extractAndFormatBody(allConversations);
    try {
      let productboardNote = await client.request.invokeTemplate("createProductboardNote", {
        context: {},
        body: JSON.stringify({
          title: `Freshdesk Ticket: ${ticket.ticket.subject}`,
          display_url: 'https://' + domainName.domainName + `/a/tickets/${ticket.ticket.id}`,
          user: {
            email: `${ticket.ticket.sender_email}`
          },
          tags: syncTags === "Yes" ? ['Freshdesk'].concat(ticket.ticket.tags) : [],
          content:          
            `${noteContent === "<p></p>" ? '' : `<h2>Summary:</h2><p>${noteContent}</p><br>`}
            <h2>Ticket Content:</h2>
            ${ticket.ticket.description}<hr/>
            ${parsedTicketConversation}
            <h2>Submitted from Freshdesk by:</h2>
            <b>${loggedInUser.loggedInUser.contact.email}</b>`,
        })
      })
      return productboardNote;
    } catch (error) {
       if (error.status === 401){
          document.getElementById('errorDisplay').textContent = 'Error 401: Invalid Productboard API token.';
          document.getElementById('errorDisplay').style.display = 'block';
          console.log(`Error 401 Unauthorized: Make sure your Productboard API token was entered correctly during installation.`)
       }
    }
  } catch (error) {
    console.log(error)
  }
}

async function addFollowerToNote(noteId) {
  const loggedInUser = await client.data.get('loggedInUser')

  try {
    const response = await client.request.invokeTemplate("addFollowerToNote", {
      context: {
        query: noteId
      },
      body: JSON.stringify(
        [
          {
            "email": loggedInUser.loggedInUser.contact.email
          }
        ]
      )
    });
    return response
  } 
  catch(error) {
    console.log("Could not add follower to note. Confirm sender has access to Productboard and has a matching account email in Freshdesk. Error details: ", error.response)
  }
};

document.getElementById('sendButton').addEventListener('click', async function () {
  if (!isInitialized) {
    console.log('Initialization not complete. Please wait.');
    return
  }
  try {
    const ticket = await client.data.get('ticket');
    if (ticket) {

      let userInput = document.getElementById('userInput').value;
      document.getElementById('sendButton').loading = true;

      const response = await sendProductboardNote(`<p>${userInput}</p>`)
      if (response.status === 201) {
        const parsedResponse = JSON.parse(response.response);
        const productboardNoteLink = parsedResponse.links.html;
        const noteId = parsedResponse.data.id;
        addFollowerToNote(noteId)
        // Wait until the note is created in Productboard
        await productboardNotes.create({
          URL: productboardNoteLink,
          ticket_id: ticket.ticket.id
        });
        console.log('Note added to Productboard successfully!');

        // Render notes after sending the note to Productboard
        await renderNotes();
        document.querySelector('fw-textarea').value = ''
        // Hide loading icon
        document.getElementById('sendButton').loading = false;
      } else {
        console.error('Error adding note to Productboard:', response.response);
        document.getElementById('sendButton').loading = false;
      }
    } else {
      console.error('Unable to retrieve ticket details.');
      document.getElementById('sendButton').loading = false;
    }
  } catch (error) {
    console.error('Error retrieving ticket details:', error);
    document.getElementById('sendButton').loading = false;
  }
});

function extractAndFormatBody(payload) {
  return payload.reduce((acc, message, index) => {
    const private = message.private;
    const source = message.source;
    let replyNumber = index + 1;
    let replyHeader;
    const fromEmail = message.from_email;
    if (private && source === 2) {
      replyHeader = `<b>#${replyNumber}: Internal note`
    } else if (!private && source === 2) {
      replyHeader = `<b>#${replyNumber}: External note`
    }
      else {
      replyHeader = `<b>#${replyNumber}: Reply from ${fromEmail}`
    }
    const timestamp = formatTimestamp(message.created_at);
    const formattedBody = `${replyHeader} on ${timestamp}</b>:${message.body}<hr/>`;
    return acc + formattedBody;
  }, '');
}

function formatTimestamp(timestamp) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
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