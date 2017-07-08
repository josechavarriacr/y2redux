import React from "react";
import LoginView from "../../Login/components/LoginView";
import LoginForm, {FORM_NAME} from "../components/LoginForm";
import {actions as formActions, getFormValues, SubmissionError} from "redux-form";
import {connect} from "react-redux";
import {routeActions} from "redux-simple-router";
import {getRandomUsername} from "../sources/user";
import {actions} from "../modules/audio";

const mapDispatchToProps = {
  onSubmit: ({username}) => {
    return dispatch => dispatch(actions.login(username))
      .then(() => dispatch(routeActions.replace('/audio')))
      .catch(e => {
        throw new SubmissionError({username: 'Server Error :('})
      })
  },
  onSurprise: () => dispatch => {
    getRandomUsername().then(username => {
      dispatch(formActions.initialize(FORM_NAME, {username}, ['username']))
      dispatch(formActions.reset(FORM_NAME))
    })
  }
}

const mapStateToProps = (state) => {
  return {...getFormValues(FORM_NAME)(state)}
}

const LoginContainer = props => (
  <LoginView>
    <LoginForm {...props}/>
  </LoginView>
)

export default connect(mapStateToProps, mapDispatchToProps)(LoginContainer)
