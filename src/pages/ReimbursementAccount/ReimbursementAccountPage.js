import React, { useState, useRef, useEffect } from 'react';
import _ from 'underscore';
import lodashGet from 'lodash/get';
import React from 'react';
import {withOnyx} from 'react-native-onyx';
import Str from 'expensify-common/lib/str';
import {View} from 'react-native';
import PropTypes from 'prop-types';
import ScreenWrapper from '../../components/ScreenWrapper';
import * as BankAccounts from '../../libs/actions/BankAccounts';
import ONYXKEYS from '../../ONYXKEYS';
import ReimbursementAccountLoadingIndicator from '../../components/ReimbursementAccountLoadingIndicator';
import Navigation from '../../libs/Navigation/Navigation';
import CONST from '../../CONST';
import BankAccount from '../../libs/models/BankAccount';
import withLocalize, {withLocalizePropTypes} from '../../components/withLocalize';
import compose from '../../libs/compose';
import styles from '../../styles/styles';
import getPlaidOAuthReceivedRedirectURI from '../../libs/getPlaidOAuthReceivedRedirectURI';
import Text from '../../components/Text';
import {withNetwork} from '../../components/OnyxProvider';
import networkPropTypes from '../../components/networkPropTypes';
import BankAccountStep from './BankAccountStep';
import CompanyStep from './CompanyStep';
import ContinueBankAccountSetup from './ContinueBankAccountSetup';
import RequestorStep from './RequestorStep';
import ValidationStep from './ValidationStep';
import ACHContractStep from './ACHContractStep';
import EnableStep from './EnableStep';
import ROUTES from '../../ROUTES';
import HeaderWithBackButton from '../../components/HeaderWithBackButton';
import * as ReimbursementAccountProps from './reimbursementAccountPropTypes';
import reimbursementAccountDraftPropTypes from './ReimbursementAccountDraftPropTypes';
import withPolicy from '../workspace/withPolicy';
import FullPageNotFoundView from '../../components/BlockingViews/FullPageNotFoundView';
import * as PolicyUtils from '../../libs/PolicyUtils';
import shouldReopenOnfido from '../../libs/shouldReopenOnfido';

const propTypes = {
    /** Plaid SDK token to use to initialize the widget */
    plaidLinkToken: PropTypes.string,

    /** ACH data for the withdrawal account actively being set up */
    reimbursementAccount: ReimbursementAccountProps.reimbursementAccountPropTypes,

    /** The draft values of the bank account being setup */
    reimbursementAccountDraft: reimbursementAccountDraftPropTypes,

    /** The token required to initialize the Onfido SDK */
    onfidoToken: PropTypes.string,

    /** Indicated whether the report data is loading */
    isLoadingReportData: PropTypes.bool,

    /** Holds information about the users account that is logging in */
    account: PropTypes.shape({
        /** Whether a sign on form is loading (being submitted) */
        isLoading: PropTypes.bool,
    }),

    /** Information about the network  */
    network: networkPropTypes.isRequired,

    /** Current session for the user */
    session: PropTypes.shape({
        /** User login */
        email: PropTypes.string,
    }),

    /** Route object from navigation */
    route: PropTypes.shape({
        /** Params that are passed into the route */
        params: PropTypes.shape({
            /** A step to navigate to if we need to drop the user into a specific point in the flow */
            stepToOpen: PropTypes.string,
            policyID: PropTypes.string,
        }),
    }),

    ...withLocalizePropTypes,
};

const defaultProps = {
    reimbursementAccount: ReimbursementAccountProps.reimbursementAccountDefaultProps,
    reimbursementAccountDraft: {},
    onfidoToken: '',
    plaidLinkToken: '',
    isLoadingReportData: false,
    account: {},
    session: {
        email: null,
    },
    route: {
        params: {
            stepToOpen: '',
            policyID: '',
        },
    },
};

function ReimbursementAccountPage({
    reimbursementAccount,
    network,
    route,
    onfidoToken,
    policy,
    account,
    isLoadingReportData,
    session,
    translate,
    plaidLinkToken,
    reimbursementAccountDraft,

}) {

    const [shouldShowContinueSetupButton, setShouldShowContinueSetupButton] = useState(false);
    const [hasACHDataBeenLoaded, setHasACHDataBeenLoaded] = useState(false);    
    const requestorStepRef = useRef(null);


    constructor(props) {
        super(props);
        this.continue = this.continue.bind(this);
        this.getDefaultStateForField = this.getDefaultStateForField.bind(this);
        this.goBack = this.goBack.bind(this);
        requestorStepRef = React.createRef();

        // The first time we open this page, the props.reimbursementAccount has not been loaded from the server.
        // Calculating shouldShowContinueSetupButton on the default data doesn't make sense, and we should recalculate
        // it once we get the response from the server the first time in componentDidUpdate.
        const hasACHDataBeenLoaded = reimbursementAccount !== ReimbursementAccountProps.reimbursementAccountDefaultProps;
        this.state = {
            hasACHDataBeenLoaded,
            shouldShowContinueSetupButton: hasACHDataBeenLoaded ? this.getShouldShowContinueSetupButtonInitialValue() : false,
        };
    }

    useEffect(() => {
        fetchData();
    }, []);

    // Custom hook to get the previous value
    function usePrevious(value) {
      const ref = useRef();
      useEffect(() => {
        ref.current = value;
     });
     return ref.current;
    }

    // Use the custom hook to get the previous reimbursementAccount value
    const prevReimbursementAccount = usePrevious(reimbursementAccount);

    // This useEffect handles fetching data if the network is back online and there's no DELETE pending action
    useEffect(() => {
        if (network.isOffline) return; // Exit if the network is still offline
        if (reimbursementAccount.pendingAction === CONST.RED_BRICK_ROAD_PENDING_ACTION.DELETE) return; // Exit if there's a DELETE pending action
        fetchData();
    }, [network.isOffline, reimbursementAccount.pendingAction]);

    // This useEffect deals with the ACHData loading state and updates related state variables accordingly
    useEffect(() => {
        if (hasACHDataBeenLoaded) return; // Exit if ACHData has been loaded
        if (reimbursementAccount === ReimbursementAccountProps.reimbursementAccountDefaultProps) return; // Exit if using default props
        if (reimbursementAccount.isLoading) return; // Exit if reimbursementAccount is still loading
    
        // Set local state based on initial value and set ACH data as loaded
        setShouldShowContinueSetupButton(getShouldShowContinueSetupButtonInitialValue());
        setHasACHDataBeenLoaded(true);
    }, [hasACHDataBeenLoaded, reimbursementAccount]);

    // This useEffect handles the change in pending action for reimbursementAccount to update the setup button state
    useEffect(() => {
        if (reimbursementAccount.pendingAction === prevReimbursementAccount.pendingAction) return; // Exit if pending action hasn't changed
        setShouldShowContinueSetupButton(hasInProgressVBBA());
    }, [reimbursementAccount.pendingAction]);

    // This useEffect takes care of route navigation and error handling based on various conditions
    useEffect(() => {
        const currentStep = lodashGet(reimbursementAccount, 'achData.currentStep') || CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT;
        if (shouldShowContinueSetupButton) return; // Exit if we are showing the "Continue with setup" button

        const currentStepRouteParam = getStepToOpenFromRouteParams();
        if (currentStepRouteParam === currentStep) return; // Exit if the route is showing the correct step
        if (currentStepRouteParam !== '') {
            // Clear errors if moving between steps
            BankAccounts.hideBankAccountErrors();
        }

        // Navigate based on the current step
        const backTo = lodashGet(route.params, 'backTo');
        const policyId = lodashGet(route.params, 'policyID');
        Navigation.navigate(ROUTES.BANK_ACCOUNT_WITH_STEP_TO_OPEN.getRoute(getRouteForCurrentStep(currentStep), policyId, backTo));
    }, [shouldShowContinueSetupButton, reimbursementAccount, route.params]);


    /*
     * Calculates the state used to show the "Continue with setup" view. If a bank account setup is already in progress and
     * no specific further step was passed in the url we'll show the workspace bank account reset modal if the user wishes to start over
     */
    function getShouldShowContinueSetupButtonInitialValue() {
        if (!hasInProgressVBBA()) {
            // Since there is no VBBA in progress, we won't need to show the component ContinueBankAccountSetup
            return false;
        }
        const achData = lodashGet(reimbursementAccount, 'achData', {});
        return achData.state === BankAccount.STATE.PENDING || _.contains([CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT, ''], getStepToOpenFromRouteParams());
    }

    /**
     * @param {String} fieldName
     * @param {*} defaultValue
     *
     * @returns {*}
     */
    function getDefaultStateForField(fieldName, defaultValue = '') {
        return lodashGet(reimbursementAccount, ['achData', fieldName], defaultValue);
    }

    /**
     * We can pass stepToOpen in the URL to force which step to show.
     * Mainly needed when user finished the flow in verifying state, and Ops ask them to modify some fields from a specific step.
     * @returns {String}
     */
    function getStepToOpenFromRouteParams() {
        switch (lodashGet(route, ['params', 'stepToOpen'], '')) {
            case 'new':
                return CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT;
            case 'company':
                return CONST.BANK_ACCOUNT.STEP.COMPANY;
            case 'personal-information':
                return CONST.BANK_ACCOUNT.STEP.REQUESTOR;
            case 'contract':
                return CONST.BANK_ACCOUNT.STEP.ACH_CONTRACT;
            case 'validate':
                return CONST.BANK_ACCOUNT.STEP.VALIDATION;
            case 'enable':
                return CONST.BANK_ACCOUNT.STEP.ENABLE;
            default:
                return '';
        }
    }

    /**
     * @param {String} currentStep
     * @returns {String}
     */
    function getRouteForCurrentStep(currentStep) {
        switch (currentStep) {
            case CONST.BANK_ACCOUNT.STEP.COMPANY:
                return 'company';
            case CONST.BANK_ACCOUNT.STEP.REQUESTOR:
                return 'personal-information';
            case CONST.BANK_ACCOUNT.STEP.ACH_CONTRACT:
                return 'contract';
            case CONST.BANK_ACCOUNT.STEP.VALIDATION:
                return 'validate';
            case CONST.BANK_ACCOUNT.STEP.ENABLE:
                return 'enable';
            case CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT:
            default:
                return 'new';
        }
    }

    /**
     * Returns true if a VBBA exists in any state other than OPEN or LOCKED
     * @returns {Boolean}
     */
    function hasInProgressVBBA() {
        const achData = lodashGet(reimbursementAccount, 'achData', {});
        return achData.bankAccountID && achData.state !== BankAccount.STATE.OPEN && achData.state !== BankAccount.STATE.LOCKED;
    }

    /**
     * Retrieve verified business bank account currently being set up.
     * @param {boolean} ignoreLocalCurrentStep Pass true if you want the last "updated" view (from db), not the last "viewed" view (from onyx).
     */
    function fetchData(ignoreLocalCurrentStep) {
        // Show loader right away, as optimisticData might be set only later in case multiple calls are in the queue
        BankAccounts.setReimbursementAccountLoading(true);

        // We can specify a step to navigate to by using route params when the component mounts.
        // We want to use the same stepToOpen variable when the network state changes because we can be redirected to a different step when the account refreshes.
        const stepToOpen = getStepToOpenFromRouteParams();
        const achData = lodashGet(reimbursementAccount, 'achData', {});
        const subStep = achData.subStep || '';
        const localCurrentStep = achData.currentStep || '';
        BankAccounts.openReimbursementAccountPage(stepToOpen, subStep, ignoreLocalCurrentStep ? '' : localCurrentStep);
    }

    continue() {
        this.setState({
            shouldShowContinueSetupButton: false,
        });
        this.fetchData(true);
    }

    function goBack() {
        const achData = lodashGet(reimbursementAccount, 'achData', {});
        const currentStep = achData.currentStep || CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT;
        const subStep = achData.subStep;
        const shouldShowOnfido = onfidoToken && !achData.isOnfidoSetupComplete;
        const backTo = lodashGet(route.params, 'backTo', ROUTES.HOME);
        switch (currentStep) {
            case CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT:
                if (hasInProgressVBBA()) {
                    setState({shouldShowContinueSetupButton: true});
                }
                if (subStep) {
                    BankAccounts.setBankAccountSubStep(null);
                } else {
                    Navigation.goBack(backTo);
                }
                break;
            case CONST.BANK_ACCOUNT.STEP.COMPANY:
                BankAccounts.goToWithdrawalAccountSetupStep(CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT, {subStep: CONST.BANK_ACCOUNT.SUBSTEP.MANUAL});
                break;
            case CONST.BANK_ACCOUNT.STEP.REQUESTOR:
                if (shouldShowOnfido) {
                    BankAccounts.clearOnfidoToken();
                } else {
                    BankAccounts.goToWithdrawalAccountSetupStep(CONST.BANK_ACCOUNT.STEP.COMPANY);
                }
                break;
            case CONST.BANK_ACCOUNT.STEP.ACH_CONTRACT:
                BankAccounts.clearOnfidoToken();
                BankAccounts.goToWithdrawalAccountSetupStep(CONST.BANK_ACCOUNT.STEP.REQUESTOR);
                break;
            case CONST.BANK_ACCOUNT.STEP.VALIDATION:
                if (_.contains([BankAccount.STATE.VERIFYING, BankAccount.STATE.SETUP], achData.state)) {
                    BankAccounts.goToWithdrawalAccountSetupStep(CONST.BANK_ACCOUNT.STEP.ACH_CONTRACT);
                } else if (!network.isOffline && achData.state === BankAccount.STATE.PENDING) {
                    setState({
                        shouldShowContinueSetupButton: true,
                    });
                } else {
                    Navigation.goBack(backTo);
                }
                break;
            default:
                Navigation.goBack(backTo);
        }
    }

    function render() {
        // The SetupWithdrawalAccount flow allows us to continue the flow from various points depending on where the
        // user left off. This view will refer to the achData as the single source of truth to determine which route to
        // display. We can also specify a specific route to navigate to via route params when the component first
        // mounts which will set the achData.currentStep after the account data is fetched and overwrite the logical
        // next step.
        const achData = lodashGet(reimbursementAccount, 'achData', {});
        const currentStep = achData.currentStep || CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT;
        const policyName = lodashGet(policy, 'name');
        const policyID = lodashGet(route.params, 'policyID');

        if (_.isEmpty(policy) || !PolicyUtils.isPolicyAdmin(policy)) {
            return (
                <ScreenWrapper testID={ReimbursementAccountPage.displayName}>
                    <FullPageNotFoundView
                        shouldShow
                        onBackButtonPress={() => Navigation.goBack(ROUTES.SETTINGS_WORKSPACES)}
                        subtitleKey={_.isEmpty(policy) ? undefined : 'workspace.common.notAuthorized'}
                    />
                </ScreenWrapper>
            );
        }

        const isLoading = isLoadingReportData || account.isLoading || reimbursementAccount.isLoading;

        // Prevent the full-page blocking offline view from being displayed for these steps if the device goes offline.
        const shouldShowOfflineLoader = !(
            network.isOffline &&
            _.contains([CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT, CONST.BANK_ACCOUNT.STEP.COMPANY, CONST.BANK_ACCOUNT.STEP.REQUESTOR, CONST.BANK_ACCOUNT.STEP.ACH_CONTRACT], currentStep)
        );

        // Show loading indicator when page is first time being opened and props.reimbursementAccount yet to be loaded from the server
        // or when data is being loaded. Don't show the loading indicator if we're offline and restarted the bank account setup process
        // On Android, when we open the app from the background, Onfido activity gets destroyed, so we need to reopen it.
        if ((!hasACHDataBeenLoaded || isLoading) && shouldShowOfflineLoader && (shouldReopenOnfido || !requestorStepRef.current)) {
            const isSubmittingVerificationsData = _.contains([CONST.BANK_ACCOUNT.STEP.COMPANY, CONST.BANK_ACCOUNT.STEP.REQUESTOR, CONST.BANK_ACCOUNT.STEP.ACH_CONTRACT], currentStep);
            return (
                <ReimbursementAccountLoadingIndicator
                    isSubmittingVerificationsData={isSubmittingVerificationsData}
                    onBackButtonPress={this.goBack}
                />
            );
        }

        let errorText;
        const userHasPhonePrimaryEmail = Str.endsWith(session.email, CONST.SMS.DOMAIN);
        const throttledDate = lodashGet(reimbursementAccount, 'throttledDate');
        const hasUnsupportedCurrency = lodashGet(policy, 'outputCurrency', '') !== CONST.CURRENCY.USD;

        if (userHasPhonePrimaryEmail) {
            errorText = translate('bankAccount.hasPhoneLoginError');
        } else if (throttledDate) {
            errorText = translate('bankAccount.hasBeenThrottledError');
        } else if (hasUnsupportedCurrency) {
            errorText = translate('bankAccount.hasCurrencyError');
        }

        if (errorText) {
            return (
                <ScreenWrapper testID={ReimbursementAccountPage.displayName}>
                    <HeaderWithBackButton
                        title={translate('workspace.common.connectBankAccount')}
                        subtitle={policyName}
                        onBackButtonPress={() => Navigation.goBack(ROUTES.SETTINGS_WORKSPACES)}
                    />
                    <View style={[styles.m5, styles.flex1]}>
                        <Text>{errorText}</Text>
                    </View>
                </ScreenWrapper>
            );
        }

        if (shouldShowContinueSetupButton) {
            return (
                <ContinueBankAccountSetup
                    reimbursementAccount={reimbursementAccount}
                    continue={this.continue}
                    policyName={policyName}
                    onBackButtonPress={() => {
                        Navigation.goBack(lodashGet(route.params, 'backTo', ROUTES.HOME));
                    }}
                />
            );
        }

        if (currentStep === CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT) {
            return (
                <BankAccountStep
                    reimbursementAccount={reimbursementAccount}
                    reimbursementAccountDraft={reimbursementAccountDraft}
                    onBackButtonPress={goBack}
                    receivedRedirectURI={getPlaidOAuthReceivedRedirectURI()}
                    plaidLinkOAuthToken={plaidLinkToken}
                    getDefaultStateForField={getDefaultStateForField}
                    policyName={policyName}
                    policyID={policyID}
                />
            );
        }

        if (currentStep === CONST.BANK_ACCOUNT.STEP.COMPANY) {
            return (
                <CompanyStep
                    reimbursementAccount={reimbursementAccount}
                    reimbursementAccountDraft={reimbursementAccountDraft}
                    onBackButtonPress={goBack}
                    getDefaultStateForField={getDefaultStateForField}
                    policyID={policyID}
                />
            );
        }

        if (currentStep === CONST.BANK_ACCOUNT.STEP.REQUESTOR) {
            const shouldShowOnfido = onfidoToken && !achData.isOnfidoSetupComplete;
            return (
                <RequestorStep
                    ref={requestorStepRef}
                    reimbursementAccount={reimbursementAccount}
                    reimbursementAccountDraft={reimbursementAccountDraft}
                    onBackButtonPress={goBack}
                    shouldShowOnfido={Boolean(shouldShowOnfido)}
                    getDefaultStateForField={getDefaultStateForField}
                />
            );
        }

        if (currentStep === CONST.BANK_ACCOUNT.STEP.ACH_CONTRACT) {
            return (
                <ACHContractStep
                    reimbursementAccount={reimbursementAccount}
                    reimbursementAccountDraft={reimbursementAccountDraft}
                    onBackButtonPress={goBack}
                    companyName={achData.companyName}
                    getDefaultStateForField={getDefaultStateForField}
                />
            );
        }

        if (currentStep === CONST.BANK_ACCOUNT.STEP.VALIDATION) {
            return (
                <ValidationStep
                    reimbursementAccount={reimbursementAccount}
                    onBackButtonPress={goBack}
                />
            );
        }

        if (currentStep === CONST.BANK_ACCOUNT.STEP.ENABLE) {
            return (
                <EnableStep
                    reimbursementAccount={reimbursementAccount}
                    policyName={policyName}
                />
            );
        }
    }
}

ReimbursementAccountPage.propTypes = propTypes;
ReimbursementAccountPage.defaultProps = defaultProps;

export default compose(
    withNetwork(),
    withOnyx({
        reimbursementAccount: {
            key: ONYXKEYS.REIMBURSEMENT_ACCOUNT,
        },
        reimbursementAccountDraft: {
            key: ONYXKEYS.REIMBURSEMENT_ACCOUNT_DRAFT,
        },
        session: {
            key: ONYXKEYS.SESSION,
        },
        plaidLinkToken: {
            key: ONYXKEYS.PLAID_LINK_TOKEN,
        },
        onfidoToken: {
            key: ONYXKEYS.ONFIDO_TOKEN,
        },
        isLoadingReportData: {
            key: ONYXKEYS.IS_LOADING_REPORT_DATA,
        },
        account: {
            key: ONYXKEYS.ACCOUNT,
        },
    }),
    withLocalize,
    withPolicy,
)(ReimbursementAccountPage);
