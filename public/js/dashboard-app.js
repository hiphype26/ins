// Dashboard Application

// Check authentication on load
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }
    
    // Load user info
    try {
        const user = await api('/auth/me');
        document.getElementById('user-email').textContent = user.email;
    } catch (error) {
        localStorage.removeItem('token');
        window.location.href = '/login.html';
        return;
    }
    
    // Initialize navigation
    initNavigation();
    
    // Load initial data
    await loadDashboard();
    await loadSettings();
    
    // Check hash for direct page access
    const hash = window.location.hash.slice(1) || 'dashboard';
    showPage(hash);
});

// Navigation
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            showPage(page);
            window.location.hash = page;
        });
    });
    
    // Handle browser back/forward
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.slice(1) || 'dashboard';
        showPage(hash);
    });
}

function showPage(pageName) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.add('hidden');
    });
    
    // Show selected page
    const targetPage = document.getElementById(`page-${pageName}`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }
    
    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageName) {
            item.classList.add('active');
        }
    });
    
    // Only stop the countdown display when leaving Volna Test (keep auto-refresh running)
    if (pageName !== 'volna-test') {
        if (volnaCountdownInterval) {
            clearInterval(volnaCountdownInterval);
            volnaCountdownInterval = null;
        }
    }
    
    // Load page-specific data
    if (pageName === 'dashboard') {
        loadDashboard();
    } else if (pageName === 'job-data') {
        loadJobData();
    } else if (pageName === 'volna-test') {
        // Auto-fetch on page load
        fetchVolnaJobs();
        
        // Restore auto-refresh UI state if it's still running
        const checkbox = document.getElementById('volna-auto-refresh');
        const nextRefreshContainer = document.getElementById('volna-next-refresh-container');
        if (volnaAutoRefreshInterval) {
            checkbox.checked = true;
            nextRefreshContainer.style.display = 'inline';
            // Restart countdown display
            updateNextRefreshCountdown();
            volnaCountdownInterval = setInterval(updateNextRefreshCountdown, 1000);
        } else {
            checkbox.checked = false;
            nextRefreshContainer.style.display = 'none';
        }
    } else if (pageName === 'settings') {
        checkUpworkStatus();
    }
}

// Logout
function logout() {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
}

// Dashboard
async function loadDashboard() {
    try {
        // Load stats
        const stats = await api('/jobs/stats/queue');
        document.getElementById('stat-queued').textContent = stats.queued || 0;
        document.getElementById('stat-processing').textContent = stats.processing || 0;
        document.getElementById('stat-completed').textContent = stats.completed || 0;
        document.getElementById('stat-failed').textContent = stats.failed || 0;
        document.getElementById('stat-rate-limit').textContent = 
            `${stats.rateLimitUsed || 0}/${stats.rateLimitMax || 50}`;
        
        // Load Upwork status
        const upwork = await api('/upwork/status');
        const statusEl = document.getElementById('stat-upwork-status');
        if (upwork.connected) {
            statusEl.textContent = 'Connected';
            statusEl.style.color = 'var(--success)';
        } else {
            statusEl.textContent = 'Not Connected';
            statusEl.style.color = 'var(--danger)';
        }
        
        // Check maintenance mode
        const settings = await api('/settings');
        const maintenanceMode = settings.find(s => s.key === 'maintenance_mode');
        const banner = document.getElementById('maintenance-banner');
        if (maintenanceMode && maintenanceMode.value === 'true') {
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
        
        // Load Volna filter stats
        await loadVolnaFilterStats();
    } catch (error) {
        console.error('Failed to load dashboard:', error);
    }
}

// Load Volna Filter Stats
async function loadVolnaFilterStats() {
    const container = document.getElementById('volna-filter-stats');
    
    try {
        const response = await api('/volna/stats');
        
        if (!response.filters || response.filters.length === 0) {
            container.innerHTML = `
                <div class="filter-stat-card">
                    <div class="filter-stat-header">
                        <span class="filter-stat-id">No filters configured</span>
                    </div>
                    <p style="color: var(--gray-500); font-size: 13px;">
                        Go to Settings to add Volna Filter IDs
                    </p>
                </div>
            `;
            return;
        }
        
        // Format time ranges for display
        const timeRanges = response.timeRanges || {};
        const formatTimeRange = (start, end) => {
            const startTime = new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTime = new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `${startTime} - ${endTime}`;
        };
        const formatDateRange = (start, end) => {
            const startDate = new Date(start);
            const endDate = new Date(end);
            const startStr = startDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endStr = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `${startStr} - ${endStr}`;
        };
        
        const oneHourRange = timeRanges.oneHourAgo && timeRanges.now 
            ? formatTimeRange(timeRanges.oneHourAgo, timeRanges.now) 
            : '';
        const twentyFourHourRange = timeRanges.twentyFourHoursAgo && timeRanges.now 
            ? formatDateRange(timeRanges.twentyFourHoursAgo, timeRanges.now) 
            : '';
        
        container.innerHTML = response.filters.map(filter => `
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">Filter #${filter.filterId}</span>
                    <span class="filter-stat-badge ${filter.status === 'error' ? 'error' : ''}">${filter.status}</span>
                </div>
                ${filter.status === 'error' ? `
                    <p style="color: var(--danger); font-size: 13px;">${filter.error}</p>
                ` : `
                    <div class="filter-stat-row">
                        <span class="filter-stat-label">Jobs in last 1 hour <span class="time-range">(${oneHourRange})</span></span>
                        <span class="filter-stat-value highlight">${filter.lastHour}</span>
                    </div>
                    <div class="filter-stat-row">
                        <span class="filter-stat-label">Jobs in last 24 hours <span class="time-range">(${twentyFourHourRange})</span></span>
                        <span class="filter-stat-value highlight">${filter.last24Hours}</span>
                    </div>
                    <div class="filter-stat-row">
                        <span class="filter-stat-label">Total jobs available</span>
                        <span class="filter-stat-value">${filter.total}</span>
                    </div>
                `}
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `
            <div class="filter-stat-card">
                <div class="filter-stat-header">
                    <span class="filter-stat-id">Error loading stats</span>
                </div>
                <p style="color: var(--danger); font-size: 13px;">${error.message}</p>
            </div>
        `;
    }
}

// Job Data
async function loadJobData() {
    try {
        const jobs = await api('/jobs');
        const tbody = document.getElementById('job-data-body');
        const emptyState = document.getElementById('job-data-empty');
        const tableContainer = document.querySelector('#page-job-data .table-container');
        
        if (!jobs || jobs.length === 0) {
            tableContainer.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }
        
        tableContainer.style.display = 'block';
        emptyState.style.display = 'none';
        
        tbody.innerHTML = jobs.map(job => {
            const result = job.result || {};
            return `
                <tr>
                    <td><a href="${job.jobUrl}" target="_blank" class="job-url">${job.jobUrl}</a></td>
                    <td>${result.title || '-'}</td>
                    <td>${result.client_city || '-'}</td>
                    <td>${result.client_country || '-'}</td>
                    <td>${result.client_rating || '-'}</td>
                    <td><span class="status-badge status-${job.status}">${job.status}</span></td>
                    <td>
                        <button class="btn btn-secondary btn-small" onclick='showJobModal(${JSON.stringify(job).replace(/'/g, "\\'")})'>
                            View
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Failed to load job data:', error);
        showToast('Failed to load job data', 'error');
    }
}

function refreshJobData() {
    loadJobData();
    showToast('Job data refreshed');
}

// Job Modal
function showJobModal(job) {
    const modal = document.getElementById('job-modal');
    const modalBody = document.getElementById('modal-body');
    const result = job.result || {};
    
    modalBody.innerHTML = `
        <div class="modal-detail-grid">
            <div class="modal-detail-item full-width">
                <div class="modal-detail-label">Job URL</div>
                <div class="modal-detail-value">
                    <a href="${job.jobUrl}" target="_blank">${job.jobUrl}</a>
                </div>
            </div>
            <div class="modal-detail-item full-width">
                <div class="modal-detail-label">Title</div>
                <div class="modal-detail-value">${result.title || '-'}</div>
            </div>
            <div class="modal-detail-item full-width">
                <div class="modal-detail-label">Description</div>
                <div class="modal-detail-value description">${result.description || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Skills</div>
                <div class="modal-detail-value">${result.skills || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Posted Date</div>
                <div class="modal-detail-value">${result.posted_date || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Budget</div>
                <div class="modal-detail-value">${result.budget || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Proposals Count</div>
                <div class="modal-detail-value">${result.proposals_count || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Name</div>
                <div class="modal-detail-value">${result.client_name || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client City</div>
                <div class="modal-detail-value">${result.client_city || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Country</div>
                <div class="modal-detail-value">${result.client_country || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Total Spent</div>
                <div class="modal-detail-value">${result.client_spend || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Hires</div>
                <div class="modal-detail-value">${result.client_hires || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Reviews</div>
                <div class="modal-detail-value">${result.client_reviews || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Client Rating</div>
                <div class="modal-detail-value">${result.client_rating || '-'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Payment Verified</div>
                <div class="modal-detail-value">${result.client_verified ? 'Yes' : 'No'}</div>
            </div>
            <div class="modal-detail-item">
                <div class="modal-detail-label">Status</div>
                <div class="modal-detail-value">
                    <span class="status-badge status-${job.status}">${job.status}</span>
                </div>
            </div>
            ${job.error ? `
            <div class="modal-detail-item full-width">
                <div class="modal-detail-label">Error</div>
                <div class="modal-detail-value" style="color: var(--danger);">${job.error}</div>
            </div>
            ` : ''}
        </div>
    `;
    
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('job-modal').classList.add('hidden');
}

// Test Page
async function submitTestJob() {
    const urlInput = document.getElementById('job-url-input');
    const submitText = document.getElementById('test-submit-text');
    const submitLoading = document.getElementById('test-submit-loading');
    const resultContainer = document.getElementById('test-result-container');
    
    const jobUrl = urlInput.value.trim();
    
    if (!jobUrl) {
        showToast('Please enter a job URL', 'error');
        return;
    }
    
    // Show loading state
    submitText.classList.add('hidden');
    submitLoading.classList.remove('hidden');
    
    try {
        // Submit job for processing
        const response = await api('/jobs/test', {
            method: 'POST',
            body: JSON.stringify({ jobUrl })
        });
        
        // Display results
        displayTestResults(response);
        resultContainer.classList.remove('hidden');
        showToast('Job details fetched successfully', 'success');
    } catch (error) {
        showToast(error.message || 'Failed to fetch job details', 'error');
    } finally {
        submitText.classList.remove('hidden');
        submitLoading.classList.add('hidden');
    }
}

function displayTestResults(data) {
    const grid = document.getElementById('test-result-grid');
    
    const fields = [
        { key: 'title', label: 'Title' },
        { key: 'description', label: 'Description', class: 'description' },
        { key: 'skills', label: 'Skills' },
        { key: 'posted_date', label: 'Posted Date' },
        { key: 'budget', label: 'Budget' },
        { key: 'proposals_count', label: 'Proposals Count' },
        { key: 'client_name', label: 'Client Name' },
        { key: 'client_city', label: 'Client City' },
        { key: 'client_country', label: 'Client Country' },
        { key: 'client_spend', label: 'Client Total Spent' },
        { key: 'client_hires', label: 'Client Hires' },
        { key: 'client_reviews', label: 'Client Reviews' },
        { key: 'client_rating', label: 'Client Rating' },
        { key: 'client_verified', label: 'Payment Verified' }
    ];
    
    grid.innerHTML = fields.map(field => `
        <div class="result-item">
            <div class="result-label">${field.label}</div>
            <div class="result-value ${field.class || ''}">${
                field.key === 'client_verified' 
                    ? (data[field.key] ? 'Yes' : 'No')
                    : (data[field.key] || '-')
            }</div>
        </div>
    `).join('');
}

// Volna Test
let volnaAutoRefreshInterval = null;
let volnaNextRefreshTime = null;
let volnaCountdownInterval = null;

// Pagination state
let volnaAllProjects = [];
let volnaCurrentPage = 1;
const volnaPageSize = 20;

async function fetchVolnaJobs(silent = false) {
    const fetchText = document.getElementById('volna-fetch-text');
    const fetchLoading = document.getElementById('volna-fetch-loading');
    const lastFetchEl = document.getElementById('volna-last-fetch');
    const projectCountEl = document.getElementById('volna-project-count');
    
    if (!silent) {
        fetchText.classList.add('hidden');
        fetchLoading.classList.remove('hidden');
    }
    
    try {
        const response = await api('/volna/jobs');
        
        // Update timestamp with exact time
        const now = new Date();
        lastFetchEl.textContent = formatTimestamp(now, true);
        projectCountEl.textContent = response ? response.length : 0;
        
        // Store all projects for pagination
        volnaAllProjects = response || [];
        volnaCurrentPage = 1;
        
        // Render with pagination
        renderVolnaProjects();
        
        if (!silent && response && response.length > 0) {
            showToast(`Found ${response.length} projects from Volna`, 'success');
        }
    } catch (error) {
        if (!silent) {
            showToast(error.message || 'Failed to fetch Volna projects', 'error');
        }
        volnaAllProjects = [];
        renderVolnaProjects();
    } finally {
        fetchText.classList.remove('hidden');
        fetchLoading.classList.add('hidden');
    }
}

function renderVolnaProjects() {
    const resultsContainer = document.getElementById('volna-results');
    const paginationContainer = document.getElementById('volna-pagination');
    
    if (!volnaAllProjects || volnaAllProjects.length === 0) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📭</span>
                <p>No projects found from Volna filter</p>
            </div>
        `;
        paginationContainer.style.display = 'none';
        return;
    }
    
    // Calculate pagination
    const totalPages = Math.ceil(volnaAllProjects.length / volnaPageSize);
    const startIndex = (volnaCurrentPage - 1) * volnaPageSize;
    const endIndex = startIndex + volnaPageSize;
    const pageProjects = volnaAllProjects.slice(startIndex, endIndex);
    
    // Render projects
    resultsContainer.innerHTML = `
        <div class="volna-job-list">
            ${pageProjects.map((project, index) => `
                <div class="volna-job-item">
                    <div class="volna-job-number">${startIndex + index + 1}</div>
                    <div class="volna-job-info">
                        <div class="volna-job-title">${project.title || 'Untitled'}</div>
                        <div class="volna-job-meta">
                            <span>${project.budget_type || ''} ${project.budget_amount || ''}</span>
                            ${project.client_country ? `<span>📍 ${project.client_country}</span>` : ''}
                            ${project.client_rating ? `<span>⭐ ${project.client_rating}</span>` : ''}
                            ${project.client_verified ? '<span>✓ Verified</span>' : ''}
                        </div>
                        <a href="${project.url}" target="_blank" class="volna-job-url">${project.url}</a>
                        ${project.published_at ? `<div class="volna-job-time">Posted: ${formatTimestamp(new Date(project.published_at))}</div>` : ''}
                    </div>
                    <button class="btn btn-primary btn-small" onclick="addVolnaJobToQueue('${project.url}')">
                        Add to Queue
                    </button>
                </div>
            `).join('')}
        </div>
    `;
    
    // Update pagination
    if (totalPages > 1) {
        paginationContainer.style.display = 'flex';
        document.getElementById('volna-current-page').textContent = volnaCurrentPage;
        document.getElementById('volna-total-pages').textContent = totalPages;
        document.getElementById('volna-total-items').textContent = volnaAllProjects.length;
        
        document.getElementById('volna-prev-btn').disabled = volnaCurrentPage === 1;
        document.getElementById('volna-next-btn').disabled = volnaCurrentPage === totalPages;
    } else {
        paginationContainer.style.display = 'none';
    }
}

function volnaChangePage(delta) {
    const totalPages = Math.ceil(volnaAllProjects.length / volnaPageSize);
    const newPage = volnaCurrentPage + delta;
    
    if (newPage >= 1 && newPage <= totalPages) {
        volnaCurrentPage = newPage;
        renderVolnaProjects();
        
        // Scroll to top of results
        document.getElementById('volna-results').scrollIntoView({ behavior: 'smooth' });
    }
}

function formatTimestamp(date, showExactTime = false) {
    // Always show exact time for "Last fetched"
    if (showExactTime) {
        return date.toLocaleTimeString();
    }
    
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) {
        return 'Just now';
    } else if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        return `${mins} min${mins > 1 ? 's' : ''} ago`;
    } else if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
        return date.toLocaleString();
    }
}

function toggleVolnaAutoRefresh() {
    const checkbox = document.getElementById('volna-auto-refresh');
    const nextRefreshContainer = document.getElementById('volna-next-refresh-container');
    
    if (checkbox.checked) {
        // Start auto-refresh (every 30 seconds)
        const refreshInterval = 30000; // 30 seconds
        
        // Set next refresh time
        volnaNextRefreshTime = Date.now() + refreshInterval;
        nextRefreshContainer.style.display = 'flex';
        
        // Start countdown
        updateNextRefreshCountdown();
        volnaCountdownInterval = setInterval(updateNextRefreshCountdown, 1000);
        
        // Start auto-refresh
        volnaAutoRefreshInterval = setInterval(() => {
            fetchVolnaJobs(true);
            volnaNextRefreshTime = Date.now() + refreshInterval;
        }, refreshInterval);
        
        showToast('Auto-refresh enabled (every 30s)', 'success');
    } else {
        // Stop auto-refresh
        if (volnaAutoRefreshInterval) {
            clearInterval(volnaAutoRefreshInterval);
            volnaAutoRefreshInterval = null;
        }
        if (volnaCountdownInterval) {
            clearInterval(volnaCountdownInterval);
            volnaCountdownInterval = null;
        }
        nextRefreshContainer.style.display = 'none';
        showToast('Auto-refresh disabled');
    }
}

function updateNextRefreshCountdown() {
    const nextRefreshEl = document.getElementById('volna-next-refresh');
    if (!volnaNextRefreshTime) return;
    
    const remaining = Math.max(0, Math.ceil((volnaNextRefreshTime - Date.now()) / 1000));
    nextRefreshEl.textContent = `${remaining}s`;
}

async function addVolnaJobToQueue(url) {
    try {
        await api('/jobs', {
            method: 'POST',
            body: JSON.stringify({ jobUrl: url })
        });
        showToast('Job added to queue', 'success');
    } catch (error) {
        showToast(error.message || 'Failed to add job', 'error');
    }
}

// Settings
async function loadSettings() {
    try {
        const settings = await api('/settings');
        
        settings.forEach(setting => {
            switch (setting.key) {
                case 'maintenance_mode':
                    document.getElementById('maintenance-mode-toggle').checked = setting.value === 'true';
                    break;
                case 'upwork_rate_limit':
                    document.getElementById('upwork-rate-limit').value = setting.value;
                    break;
                case 'min_interval':
                    document.getElementById('min-interval').value = setting.value;
                    break;
                case 'max_interval':
                    document.getElementById('max-interval').value = setting.value;
                    break;
                case 'upwork_client_id':
                    document.getElementById('upwork-client-id').value = setting.value;
                    break;
                case 'upwork_client_secret':
                    document.getElementById('upwork-client-secret').value = setting.value;
                    break;
                case 'upwork_redirect_uri':
                    document.getElementById('upwork-redirect-uri').value = setting.value;
                    break;
                case 'volna_api_key':
                    document.getElementById('volna-api-key').value = setting.value;
                    break;
                case 'volna_filter_id_1':
                    document.getElementById('volna-filter-id-1').value = setting.value;
                    break;
                case 'volna_filter_id_2':
                    document.getElementById('volna-filter-id-2').value = setting.value;
                    break;
                case 'volna_filter_id_3':
                    document.getElementById('volna-filter-id-3').value = setting.value;
                    break;
                case 'volna_filter_id_4':
                    document.getElementById('volna-filter-id-4').value = setting.value;
                    break;
                case 'volna_auto_fetch':
                    document.getElementById('volna-auto-fetch-toggle').checked = setting.value === 'true';
                    break;
                case 'volna_fetch_interval':
                    document.getElementById('volna-fetch-interval').value = setting.value;
                    break;
                case 'volna_auto_add':
                    document.getElementById('volna-auto-add-toggle').checked = setting.value === 'true';
                    break;
            }
        });
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

async function toggleMaintenanceMode() {
    const isEnabled = document.getElementById('maintenance-mode-toggle').checked;
    
    try {
        await api('/settings', {
            method: 'POST',
            body: JSON.stringify({
                key: 'maintenance_mode',
                value: isEnabled.toString()
            })
        });
        
        // Update dashboard banner
        const banner = document.getElementById('maintenance-banner');
        if (isEnabled) {
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
        
        showToast(`Maintenance mode ${isEnabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (error) {
        showToast('Failed to update maintenance mode', 'error');
        // Revert toggle
        document.getElementById('maintenance-mode-toggle').checked = !isEnabled;
    }
}

async function saveSettings() {
    const settings = [
        { key: 'upwork_rate_limit', value: document.getElementById('upwork-rate-limit').value },
        { key: 'min_interval', value: document.getElementById('min-interval').value },
        { key: 'max_interval', value: document.getElementById('max-interval').value },
        { key: 'upwork_client_id', value: document.getElementById('upwork-client-id').value },
        { key: 'upwork_client_secret', value: document.getElementById('upwork-client-secret').value },
        { key: 'upwork_redirect_uri', value: document.getElementById('upwork-redirect-uri').value },
        { key: 'volna_api_key', value: document.getElementById('volna-api-key').value },
        { key: 'volna_filter_id_1', value: document.getElementById('volna-filter-id-1').value },
        { key: 'volna_filter_id_2', value: document.getElementById('volna-filter-id-2').value },
        { key: 'volna_filter_id_3', value: document.getElementById('volna-filter-id-3').value },
        { key: 'volna_filter_id_4', value: document.getElementById('volna-filter-id-4').value },
        { key: 'volna_auto_fetch', value: document.getElementById('volna-auto-fetch-toggle').checked.toString() },
        { key: 'volna_fetch_interval', value: document.getElementById('volna-fetch-interval').value },
        { key: 'volna_auto_add', value: document.getElementById('volna-auto-add-toggle').checked.toString() }
    ];
    
    try {
        await api('/settings/bulk', {
            method: 'POST',
            body: JSON.stringify({ settings })
        });
        
        showToast('Settings saved successfully', 'success');
    } catch (error) {
        showToast('Failed to save settings', 'error');
    }
}

// Toast notifications
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    
    toast.className = 'toast';
    toast.classList.add(type);
    toastMessage.textContent = message;
    
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Upwork Connection
async function checkUpworkStatus() {
    try {
        const status = await api('/upwork/status');
        const statusEl = document.getElementById('upwork-connection-status');
        const connectBtn = document.getElementById('upwork-connect-btn');
        const disconnectBtn = document.getElementById('upwork-disconnect-btn');
        
        if (status.connected) {
            statusEl.textContent = 'Connected';
            statusEl.style.color = '#10b981';
            connectBtn.style.display = 'none';
            disconnectBtn.style.display = 'inline-block';
        } else {
            statusEl.textContent = 'Not connected';
            statusEl.style.color = '#6b7280';
            connectBtn.style.display = 'inline-block';
            disconnectBtn.style.display = 'none';
        }
    } catch (error) {
        document.getElementById('upwork-connection-status').textContent = 'Status unknown';
    }
}

async function connectUpwork() {
    try {
        // First save settings in case they were just entered
        await saveSettings();
        
        const data = await api('/upwork/login');
        if (data.authUrl) {
            window.location.href = data.authUrl;
        } else if (data.error) {
            showToast(data.error, 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to connect to Upwork', 'error');
    }
}

async function disconnectUpwork() {
    if (!confirm('Are you sure you want to disconnect from Upwork?')) return;
    
    try {
        await api('/upwork/disconnect', { method: 'POST' });
        showToast('Disconnected from Upwork', 'success');
        checkUpworkStatus();
    } catch (error) {
        showToast('Failed to disconnect', 'error');
    }
}

// Auto-refresh dashboard every 30 seconds
setInterval(() => {
    const activePage = document.querySelector('.page:not(.hidden)');
    if (activePage && activePage.id === 'page-dashboard') {
        loadDashboard();
    }
}, 30000);
